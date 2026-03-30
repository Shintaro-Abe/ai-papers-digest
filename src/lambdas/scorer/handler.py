"""Lambda handler for paper scoring and filtering."""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from .filter import filter_papers
from .scoring import calculate_scores

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

JST = timezone(timedelta(hours=9))

dynamodb = boto3.resource("dynamodb")
ecs_client = boto3.client("ecs")

INITIAL_WEIGHTS = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}


def _today_jst() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d")


def _get_weights(config_table_name: str) -> dict[str, float]:
    """Load scoring weights from config table."""
    table = dynamodb.Table(config_table_name)
    try:
        resp = table.get_item(Key={"key": "scoring_weights"})
        item = resp.get("Item")
        if item:
            return json.loads(item["value"])
    except Exception:
        logger.exception("Failed to load scoring weights, using defaults")
    return INITIAL_WEIGHTS


def _get_papers_by_date(papers_table_name: str, date: str) -> list[dict[str, Any]]:
    """Fetch papers collected on the given date."""
    table = dynamodb.Table(papers_table_name)
    # Scan with filter since score attribute may not exist yet (GSI won't include items without SK)
    resp = table.scan(
        FilterExpression="collected_date = :d",
        ExpressionAttributeValues={":d": date},
    )
    items = resp.get("Items", [])
    # Handle pagination
    while "LastEvaluatedKey" in resp:
        resp = table.scan(
            FilterExpression="collected_date = :d",
            ExpressionAttributeValues={":d": date},
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp.get("Items", []))
    return items


def _get_delivered_ids(delivery_log_table_name: str, lookback_days: int = 30) -> set[str]:
    """Fetch arXiv IDs that have been delivered in the past N days."""
    table = dynamodb.Table(delivery_log_table_name)
    delivered: set[str] = set()

    today = datetime.now(JST)
    for i in range(lookback_days):
        date = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            resp = table.query(KeyConditionExpression=Key("date").eq(date))
            for item in resp.get("Items", []):
                delivered.add(item["arxiv_id"])
        except Exception:
            logger.warning("Failed to query delivery_log for date=%s", date)

    return delivered


def _run_fargate_task(selected_ids: list[str], date: str) -> str:
    """Start ECS Fargate task for summarization."""
    cluster = os.environ["ECS_CLUSTER"]
    task_def = os.environ["ECS_TASK_DEFINITION"]
    subnets = os.environ["ECS_SUBNETS"].split(",")
    security_group = os.environ["ECS_SECURITY_GROUP"]

    resp = ecs_client.run_task(
        cluster=cluster,
        taskDefinition=task_def,
        capacityProviderStrategy=[
            {"capacityProvider": "FARGATE_SPOT", "weight": 1},
        ],
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": subnets,
                "securityGroups": [security_group],
                "assignPublicIp": "ENABLED",
            },
        },
        overrides={
            "containerOverrides": [
                {
                    "name": "summarizer",
                    "environment": [
                        {"name": "PAPER_IDS", "value": json.dumps(selected_ids)},
                        {"name": "TARGET_DATE", "value": date},
                    ],
                },
            ],
        },
    )

    task_arn = resp["tasks"][0]["taskArn"] if resp.get("tasks") else "unknown"
    logger.info("Started Fargate task: %s", task_arn)
    return task_arn


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Score papers, filter top N, and launch Fargate summarizer."""
    date = event.get("date", _today_jst())
    top_n = int(os.environ.get("TOP_N", "7"))
    logger.info("Starting scoring for date=%s, top_n=%d", date, top_n)

    papers_table = os.environ["PAPERS_TABLE"]
    delivery_log_table = os.environ["DELIVERY_LOG_TABLE"]
    config_table = os.environ["CONFIG_TABLE"]

    # 1. Load weights
    weights = _get_weights(config_table)

    # 2. Fetch today's papers
    papers = _get_papers_by_date(papers_table, date)
    if not papers:
        logger.warning("No papers found for date=%s", date)
        return {"statusCode": 200, "body": "No papers to score"}

    # 3. Calculate scores
    scored = calculate_scores(papers, weights)

    # 4. Get delivered IDs
    delivered_ids = _get_delivered_ids(delivery_log_table)

    # 5. Filter top N
    selected = filter_papers(scored, delivered_ids, top_n)
    if not selected:
        logger.warning("No papers selected after filtering for date=%s", date)
        return {"statusCode": 200, "body": "No papers selected"}

    logger.info("Selected %d papers (top score=%.4f)", len(selected), selected[0]["score"])

    # 6. Save scores back to papers table
    table = dynamodb.Table(papers_table)
    for paper in scored:
        try:
            table.update_item(
                Key={"arxiv_id": paper["arxiv_id"]},
                UpdateExpression="SET score = :s",
                ExpressionAttributeValues={":s": paper["score"]},
            )
        except Exception:
            logger.warning("Failed to update score for %s", paper["arxiv_id"])

    # 7. Launch Fargate task
    selected_ids = [p["arxiv_id"] for p in selected]
    task_arn = _run_fargate_task(selected_ids, date)

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "date": date,
                "total_papers": len(papers),
                "selected_count": len(selected),
                "task_arn": task_arn,
            }
        ),
    }
