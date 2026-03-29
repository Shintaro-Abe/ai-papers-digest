"""Lambda handler for Slack delivery."""

import json
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from . import message_builder, slack_client

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

JST = timezone(timedelta(hours=9))

dynamodb = boto3.resource("dynamodb")


def _today_jst() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d")


def _get_summaries_by_date(table_name: str, date: str) -> list[dict[str, Any]]:
    """Fetch active summaries for the given date from summaries + papers tables."""
    summaries_table = dynamodb.Table(table_name)
    papers_table = dynamodb.Table(os.environ["DELIVERY_LOG_TABLE"].replace("delivery-log", "papers"))

    # Get all papers collected today with score > 0, then fetch their summaries
    # Actually, we query summaries table directly - items were saved with collected_date
    # For simplicity, scan summaries where is_active=true and match by date
    # Better approach: the summarizer saves the date as part of the item

    # Scan for today's summaries (low volume, acceptable)
    resp = summaries_table.scan(
        FilterExpression="is_active = :active",
        ExpressionAttributeValues={":active": True},
    )
    items = resp.get("Items", [])

    # Filter to today's date (check both JST date and UTC date since summarizer stores UTC)
    utc_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_summaries = [
        item for item in items
        if item.get("created_at", "").startswith(date) or item.get("created_at", "").startswith(utc_date)
    ]

    return today_summaries


def _record_delivery(table_name: str, date: str, arxiv_ids: list[str]) -> None:
    """Record delivery log."""
    table = dynamodb.Table(table_name)
    for arxiv_id in arxiv_ids:
        try:
            table.put_item(Item={
                "date": date,
                "arxiv_id": arxiv_id,
                "status": "delivered",
                "delivered_at": datetime.now(timezone.utc).isoformat(),
                "like_count": 0,
                "dislike_count": 0,
            })
        except Exception:
            logger.exception("Failed to record delivery for %s", arxiv_id)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Deliver summaries to Slack."""
    date = _today_jst()
    logger.info("Starting Slack delivery for date=%s", date)

    summaries_table = os.environ["SUMMARIES_TABLE"]
    delivery_log_table = os.environ["DELIVERY_LOG_TABLE"]
    webhook_secret_arn = os.environ["SLACK_WEBHOOK_SECRET_ARN"]
    base_url = os.environ["DETAIL_PAGE_BASE_URL"]

    # 1. Fetch today's summaries
    summaries = _get_summaries_by_date(summaries_table, date)
    if not summaries:
        logger.warning("No summaries found for date=%s", date)
        return {"statusCode": 200, "body": "No summaries to deliver"}

    logger.info("Found %d summaries for delivery", len(summaries))

    # 2. Build messages
    messages: list[dict[str, Any]] = []

    # Header
    digest_url = f"{base_url}/digest/{date}.html"
    header = message_builder.build_header_message(date, len(summaries), digest_url)
    messages.append(header)

    # Paper messages
    for summary in summaries:
        arxiv_id = summary["arxiv_id"]
        detail_url = f"{base_url}/papers/{arxiv_id}.html"
        msg = message_builder.build_paper_message(summary, detail_url)
        messages.append(msg)

    # 3. Post to Slack
    posted = slack_client.post_messages(webhook_secret_arn, messages)

    # 4. Record delivery log
    delivered_ids = [s["arxiv_id"] for s in summaries]
    _record_delivery(delivery_log_table, date, delivered_ids)

    return {
        "statusCode": 200,
        "body": json.dumps({
            "date": date,
            "summaries_count": len(summaries),
            "messages_posted": posted,
        }),
    }
