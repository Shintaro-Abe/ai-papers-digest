"""Lambda handler for weekly weight adjustment (Phase 2)."""

import json
import logging
import os
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import boto3
import weight_optimizer
from pipeline_runs import upsert_run_status

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

JST = timezone(timedelta(hours=9))

dynamodb = boto3.resource("dynamodb")

INITIAL_WEIGHTS = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}
LOOKBACK_WEEKS = 4
WEIGHTS_HISTORY_MAX = 12


def _today_jst() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d")


def _get_current_weights(config_table_name: str) -> dict[str, float]:
    """Load current scoring weights from config table."""
    table = dynamodb.Table(config_table_name)
    try:
        resp = table.get_item(Key={"key": "scoring_weights"})
        item = resp.get("Item")
        if item:
            return json.loads(item["value"])
    except Exception:
        logger.exception("Failed to load current weights")
    return INITIAL_WEIGHTS


def _save_weights(config_table_name: str, weights: dict[str, float]) -> None:
    """Save optimized weights to config table."""
    table = dynamodb.Table(config_table_name)
    table.put_item(
        Item={
            "key": "scoring_weights",
            "value": json.dumps(weights),
            "updated_at": datetime.now(UTC).isoformat(),
        }
    )


def _append_weights_history(
    config_table_name: str,
    weights: dict[str, float],
    *,
    skipped: bool,
    feedback_count: int,
    papers_count: int,
) -> None:
    """Append a snapshot to ``scoring_weights_history`` (most-recent-first, max 12)."""
    table = dynamodb.Table(config_table_name)
    history: list[dict[str, Any]] = []
    try:
        resp = table.get_item(Key={"key": "scoring_weights_history"})
        item = resp.get("Item")
        if item and "value" in item:
            try:
                history = json.loads(item["value"]) or []
            except (TypeError, ValueError):
                logger.warning("scoring_weights_history corrupt, resetting")
                history = []
    except Exception:
        logger.exception("Failed to load scoring_weights_history")
        history = []

    entry = {
        "date": _today_jst(),
        "w1": weights.get("w1"),
        "w2": weights.get("w2"),
        "w3": weights.get("w3"),
        "w4": weights.get("w4"),
        "skipped": skipped,
        "feedback_count": feedback_count,
        "papers_count": papers_count,
    }

    history.insert(0, entry)
    history = history[:WEIGHTS_HISTORY_MAX]

    try:
        table.put_item(
            Item={
                "key": "scoring_weights_history",
                "value": json.dumps(history),
                "updated_at": datetime.now(UTC).isoformat(),
            }
        )
    except Exception:
        logger.exception("Failed to persist scoring_weights_history")


def _get_recent_feedback(feedback_table_name: str, lookback_days: int = 28) -> list[dict[str, Any]]:
    """Fetch feedback from the past N days."""
    table = dynamodb.Table(feedback_table_name)
    cutoff = (datetime.now(UTC) - timedelta(days=lookback_days)).isoformat()

    all_items: list[dict[str, Any]] = []
    resp = table.scan(
        FilterExpression="created_at >= :cutoff",
        ExpressionAttributeValues={":cutoff": cutoff},
    )
    all_items.extend(resp.get("Items", []))

    while "LastEvaluatedKey" in resp:
        resp = table.scan(
            FilterExpression="created_at >= :cutoff",
            ExpressionAttributeValues={":cutoff": cutoff},
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        all_items.extend(resp.get("Items", []))

    logger.info("Fetched %d feedback records from past %d days", len(all_items), lookback_days)
    return all_items


def _get_recent_papers(papers_table_name: str, lookback_days: int = 28) -> list[dict[str, Any]]:
    """Fetch papers from the past N days."""
    table = dynamodb.Table(papers_table_name)
    cutoff = (datetime.now(UTC) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    all_items: list[dict[str, Any]] = []
    resp = table.scan(
        FilterExpression="collected_date >= :cutoff",
        ExpressionAttributeValues={":cutoff": cutoff},
    )
    all_items.extend(resp.get("Items", []))

    while "LastEvaluatedKey" in resp:
        resp = table.scan(
            FilterExpression="collected_date >= :cutoff",
            ExpressionAttributeValues={":cutoff": cutoff},
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        all_items.extend(resp.get("Items", []))

    logger.info("Fetched %d papers from past %d days", len(all_items), lookback_days)
    return all_items


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Weekly weight adjustment handler."""
    logger.info("Starting weekly weight adjustment")
    today = _today_jst()

    feedback_table = os.environ["FEEDBACK_TABLE"]
    papers_table = os.environ["PAPERS_TABLE"]
    config_table = os.environ["CONFIG_TABLE"]
    lookback_days = LOOKBACK_WEEKS * 7

    current_weights: dict[str, float] = INITIAL_WEIGHTS
    new_weights: dict[str, float] = INITIAL_WEIGHTS
    feedback: list[dict[str, Any]] = []
    papers: list[dict[str, Any]] = []
    skipped = False

    try:
        # 1. Load current weights
        current_weights = _get_current_weights(config_table)
        logger.info("Current weights: %s", current_weights)

        # 2. Fetch recent feedback
        feedback = _get_recent_feedback(feedback_table, lookback_days)

        # 3. Fetch recent papers
        papers = _get_recent_papers(papers_table, lookback_days)

        # 4. Optimize weights
        new_weights = weight_optimizer.optimize_weights(feedback, papers, current_weights)

        # 5. Save new weights
        if new_weights != current_weights:
            _save_weights(config_table, new_weights)
            logger.info("Weights updated: %s → %s", current_weights, new_weights)
        else:
            skipped = True
            logger.info("Weights unchanged: %s", current_weights)

        # 6. Append history snapshot (always — dashboard relies on weekly cadence)
        _append_weights_history(
            config_table, new_weights,
            skipped=skipped,
            feedback_count=len(feedback),
            papers_count=len(papers),
        )
    except Exception as exc:
        upsert_run_status(
            today, "weight_adjuster", "error", error=str(exc),
            weight_adjuster_last_run=today,
            weight_adjuster_skipped=skipped,
        )
        raise

    upsert_run_status(
        today, "weight_adjuster", "success",
        weight_adjuster_last_run=today,
        weight_adjuster_skipped=skipped,
        weights_after=new_weights,
    )

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "previous_weights": current_weights,
                "new_weights": new_weights,
                "feedback_count": len(feedback),
                "papers_count": len(papers),
                "skipped": skipped,
            }
        ),
    }
