"""Lambda handler for Slack delivery."""

import json
import logging
import os
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import boto3
import message_builder
import slack_client
from pipeline_runs import upsert_run_status

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

JST = timezone(timedelta(hours=9))

dynamodb = boto3.resource("dynamodb")


def _today_jst() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d")


def _get_summaries_by_date(table_name: str, date: str) -> list[dict[str, Any]]:
    """Fetch active summaries for the given date."""
    summaries_table = dynamodb.Table(table_name)

    resp = summaries_table.scan(
        FilterExpression="is_active = :active AND #d = :date",
        ExpressionAttributeNames={"#d": "date"},
        ExpressionAttributeValues={":active": True, ":date": date},
    )
    items = resp.get("Items", [])

    while "LastEvaluatedKey" in resp:
        resp = summaries_table.scan(
            FilterExpression="is_active = :active AND #d = :date",
            ExpressionAttributeNames={"#d": "date"},
            ExpressionAttributeValues={":active": True, ":date": date},
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp.get("Items", []))

    return items


def _get_hf_upvotes(table_name: str, arxiv_ids: list[str]) -> dict[str, int]:
    """Fetch hf_upvotes for given arxiv_ids from papers table via BatchGetItem."""
    if not arxiv_ids:
        return {}
    table = dynamodb.Table(table_name)
    result: dict[str, int] = {}
    # BatchGetItem limit is 100 keys per call
    for i in range(0, len(arxiv_ids), 100):
        chunk = arxiv_ids[i : i + 100]
        try:
            resp = dynamodb.batch_get_item(
                RequestItems={
                    table.name: {
                        "Keys": [{"arxiv_id": aid} for aid in chunk],
                        "ProjectionExpression": "arxiv_id, hf_upvotes",
                    }
                }
            )
            for item in resp.get("Responses", {}).get(table.name, []):
                aid = item.get("arxiv_id")
                upv = item.get("hf_upvotes", 0)
                if aid:
                    result[aid] = int(upv)
        except Exception:
            logger.exception("Failed to batch_get_item for hf_upvotes")
    return result


def _record_delivery(table_name: str, date: str, arxiv_id: str, message_ts: str | None) -> None:
    """Record a single delivery log entry with message ts."""
    table = dynamodb.Table(table_name)
    try:
        item: dict[str, Any] = {
            "date": date,
            "arxiv_id": arxiv_id,
            "status": "delivered",
            "delivered_at": datetime.now(UTC).isoformat(),
            "like_count": 0,
            "dislike_count": 0,
        }
        if message_ts:
            item["slack_message_ts"] = message_ts
        table.put_item(Item=item)
    except Exception:
        logger.exception("Failed to record delivery for %s", arxiv_id)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Deliver summaries to Slack."""
    date = _today_jst()
    logger.info("Starting Slack delivery for date=%s", date)

    summaries_table = os.environ["SUMMARIES_TABLE"]
    delivery_log_table = os.environ["DELIVERY_LOG_TABLE"]
    papers_table = os.environ["PAPERS_TABLE"]
    bot_token_arn = os.environ["SLACK_BOT_TOKEN_SECRET_ARN"]
    channel_id = os.environ["SLACK_CHANNEL_ID"]
    base_url = os.environ["DETAIL_PAGE_BASE_URL"]

    posted_count = 0
    summaries: list[dict[str, Any]] = []

    try:
        # 1. Fetch today's summaries
        summaries = _get_summaries_by_date(summaries_table, date)
        if not summaries:
            logger.warning("No summaries found for date=%s", date)
            upsert_run_status(date, "deliverer", "success", papers_delivered=0)
            return {"statusCode": 200, "body": "No summaries to deliver"}

        logger.info("Found %d summaries for delivery", len(summaries))

        # 2. Fetch hf_upvotes for badges
        arxiv_ids = [s["arxiv_id"] for s in summaries]
        upvotes_map = _get_hf_upvotes(papers_table, arxiv_ids)

        # 3. Build messages
        messages: list[dict[str, Any]] = []

        # Header (no arxiv_id)
        digest_url = f"{base_url}/digest/{date}.html"
        header = message_builder.build_header_message(date, len(summaries), digest_url)
        messages.append({"blocks": header["blocks"], "arxiv_id": None})

        # Paper messages
        for summary in summaries:
            arxiv_id = summary["arxiv_id"]
            detail_url = f"{base_url}/papers/{arxiv_id}.html"
            msg = message_builder.build_paper_message(
                summary, detail_url, hf_upvotes=upvotes_map.get(arxiv_id, 0)
            )
            messages.append({"blocks": msg["blocks"], "arxiv_id": arxiv_id})

        # 4. Post to Slack via Bot Token + chat.postMessage
        results = slack_client.post_messages(bot_token_arn, channel_id, messages)

        # 5. Record delivery log with ts
        for result in results:
            arxiv_id = result.get("arxiv_id")
            ts = result.get("ts")
            if arxiv_id and ts:
                _record_delivery(delivery_log_table, date, arxiv_id, ts)
                posted_count += 1
    except Exception as exc:
        upsert_run_status(date, "deliverer", "error", error=str(exc), papers_delivered=posted_count)
        raise

    upsert_run_status(date, "deliverer", "success", papers_delivered=posted_count)

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "date": date,
                "summaries_count": len(summaries),
                "messages_posted": posted_count,
            }
        ),
    }
