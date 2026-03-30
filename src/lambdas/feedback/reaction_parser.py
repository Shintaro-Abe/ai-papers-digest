"""Parse Slack reaction events and map to paper feedback."""

import logging
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr

logger = logging.getLogger(__name__)

# Slack reaction name → feedback type
REACTION_MAP = {
    "+1": "like",
    "thumbsup": "like",
    "-1": "dislike",
    "thumbsdown": "dislike",
}


def parse_reaction_event(event_body: dict[str, Any]) -> dict[str, Any] | None:
    """Parse a Slack reaction event into a feedback record.

    Args:
        event_body: The 'event' object from Slack Events API payload.

    Returns:
        Parsed feedback dict or None if not a relevant reaction.
    """
    reaction = event_body.get("reaction", "")
    feedback_type = REACTION_MAP.get(reaction)
    if not feedback_type:
        logger.debug("Ignoring reaction: %s", reaction)
        return None

    return {
        "user_id": event_body.get("user", ""),
        "reaction": feedback_type,
        "message_ts": event_body.get("item", {}).get("ts", ""),
        "channel": event_body.get("item", {}).get("channel", ""),
        "event_type": event_body.get("type", ""),  # reaction_added or reaction_removed
    }


def lookup_arxiv_id(
    delivery_log_table_name: str,
    message_ts: str,
    dynamodb_resource: Any = None,
) -> str | None:
    """Look up arxiv_id from delivery_log by Slack message timestamp.

    Args:
        delivery_log_table_name: DynamoDB table name.
        message_ts: Slack message timestamp.
        dynamodb_resource: Optional boto3 DynamoDB resource (for testing).

    Returns:
        arxiv_id if found, None otherwise.
    """
    if not dynamodb_resource:
        dynamodb_resource = boto3.resource("dynamodb")

    table = dynamodb_resource.Table(delivery_log_table_name)

    try:
        resp = table.scan(
            FilterExpression=Attr("slack_message_ts").eq(message_ts),
            ProjectionExpression="arxiv_id",
        )
        items = resp.get("Items", [])
        if items:
            return items[0].get("arxiv_id")
    except Exception:
        logger.exception("Failed to lookup arxiv_id for message_ts=%s", message_ts)

    return None
