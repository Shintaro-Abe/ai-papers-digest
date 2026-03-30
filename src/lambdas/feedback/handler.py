"""Lambda handler for Slack feedback collection (Phase 2)."""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr

import reaction_parser
import slack_verifier

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

dynamodb = boto3.resource("dynamodb")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Handle Slack Events API requests.

    Handles:
    1. URL Verification Challenge (initial setup)
    2. reaction_added events (save Like/Dislike)
    3. reaction_removed events (delete feedback)
    """
    # --- Parse API Gateway v2 payload ---
    body_str = event.get("body", "")
    is_base64 = event.get("isBase64Encoded", False)
    if is_base64:
        import base64
        body_str = base64.b64decode(body_str).decode("utf-8")

    headers = event.get("headers", {})

    # --- Parse JSON body ---
    try:
        body = json.loads(body_str)
    except (json.JSONDecodeError, TypeError):
        logger.error("Failed to parse request body")
        return {"statusCode": 400, "body": "Invalid JSON"}

    # --- 1. URL Verification Challenge ---
    if body.get("type") == "url_verification":
        challenge = body.get("challenge", "")
        logger.info("URL verification challenge received")
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"challenge": challenge}),
        }

    # --- 2. Verify Slack Signature ---
    signing_secret_arn = os.environ["SLACK_SIGNING_SECRET_ARN"]
    signing_secret = slack_verifier._get_signing_secret(signing_secret_arn)

    timestamp = headers.get("x-slack-request-timestamp", "")
    signature = headers.get("x-slack-signature", "")

    if not slack_verifier.verify_signature(signing_secret, timestamp, body_str, signature):
        logger.warning("Invalid Slack signature")
        return {"statusCode": 401, "body": "Invalid signature"}

    # --- 3. Handle event callback ---
    if body.get("type") != "event_callback":
        logger.debug("Ignoring non-event_callback type: %s", body.get("type"))
        return {"statusCode": 200, "body": "ok"}

    slack_event = body.get("event", {})
    event_type = slack_event.get("type", "")

    if event_type not in ("reaction_added", "reaction_removed"):
        logger.debug("Ignoring event type: %s", event_type)
        return {"statusCode": 200, "body": "ok"}

    # --- 4. Parse reaction ---
    parsed = reaction_parser.parse_reaction_event(slack_event)
    if not parsed:
        return {"statusCode": 200, "body": "ok"}

    # --- 5. Lookup arxiv_id from delivery_log ---
    delivery_log_table = os.environ["DELIVERY_LOG_TABLE"]
    arxiv_id = reaction_parser.lookup_arxiv_id(
        delivery_log_table, parsed["message_ts"], dynamodb
    )

    if not arxiv_id:
        logger.info("No arxiv_id found for message_ts=%s (not a paper message)", parsed["message_ts"])
        return {"statusCode": 200, "body": "ok"}

    # --- 6. Save or delete feedback ---
    feedback_table = os.environ["FEEDBACK_TABLE"]
    table = dynamodb.Table(feedback_table)

    if event_type == "reaction_added":
        table.put_item(Item={
            "user_id": parsed["user_id"],
            "arxiv_id": arxiv_id,
            "reaction": parsed["reaction"],
            "slack_message_ts": parsed["message_ts"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Saved feedback: user=%s paper=%s reaction=%s", parsed["user_id"], arxiv_id, parsed["reaction"])

        # Update delivery_log counts
        _update_delivery_counts(delivery_log_table, arxiv_id, parsed["reaction"], increment=True)

    elif event_type == "reaction_removed":
        # Get existing feedback to know which count to decrement
        try:
            existing = table.get_item(Key={"user_id": parsed["user_id"], "arxiv_id": arxiv_id})
            existing_reaction = existing.get("Item", {}).get("reaction")
        except Exception:
            existing_reaction = None

        table.delete_item(Key={
            "user_id": parsed["user_id"],
            "arxiv_id": arxiv_id,
        })
        logger.info("Deleted feedback: user=%s paper=%s", parsed["user_id"], arxiv_id)

        if existing_reaction:
            _update_delivery_counts(delivery_log_table, arxiv_id, existing_reaction, increment=False)

    return {"statusCode": 200, "body": "ok"}


def _update_delivery_counts(
    table_name: str, arxiv_id: str, reaction: str, increment: bool
) -> None:
    """Update like_count/dislike_count in delivery_log."""
    from decimal import Decimal

    table = dynamodb.Table(table_name)
    count_field = "like_count" if reaction == "like" else "dislike_count"
    delta = Decimal("1") if increment else Decimal("-1")

    logger.info("Updating delivery counts: table=%s arxiv_id=%s field=%s delta=%s", table_name, arxiv_id, count_field, delta)

    try:
        resp = table.scan(
            FilterExpression=Attr("arxiv_id").eq(arxiv_id),
            ProjectionExpression="#d, arxiv_id",
            ExpressionAttributeNames={"#d": "date"},
        )
        items = resp.get("Items", [])
        logger.info("Found %d delivery_log entries for %s", len(items), arxiv_id)
        if not items:
            return

        # Use the most recent date entry
        items.sort(key=lambda x: x.get("date", ""), reverse=True)
        item = items[0]
        table.update_item(
            Key={"date": item["date"], "arxiv_id": arxiv_id},
            UpdateExpression=f"SET {count_field} = if_not_exists({count_field}, :zero) + :delta",
            ExpressionAttributeValues={":delta": delta, ":zero": Decimal("0")},
        )
        logger.info("Updated %s for %s (date=%s)", count_field, arxiv_id, item["date"])
    except Exception:
        logger.exception("Failed to update delivery counts for %s", arxiv_id)
