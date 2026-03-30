"""Slack Bot Token client (chat.postMessage)."""

import logging
import time
from typing import Any

import boto3
import requests

logger = logging.getLogger(__name__)

SLACK_API_BASE = "https://slack.com/api"


def _get_secret(secret_arn: str) -> str:
    """Retrieve secret value from Secrets Manager."""
    client = boto3.client("secretsmanager")
    resp = client.get_secret_value(SecretId=secret_arn)
    return resp["SecretString"]


def post_message(bot_token: str, channel_id: str, blocks: list[dict[str, Any]]) -> str | None:
    """Post a message to Slack via chat.postMessage.

    Returns:
        Message ts (timestamp) if successful, None otherwise.
    """
    try:
        resp = requests.post(
            f"{SLACK_API_BASE}/chat.postMessage",
            headers={"Authorization": f"Bearer {bot_token}"},
            json={"channel": channel_id, "blocks": blocks},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("ok"):
            return data.get("ts")
        logger.error("Slack API error: %s", data.get("error", "unknown"))
        return None
    except Exception:
        logger.exception("Failed to post Slack message")
        return None


def post_messages(
    bot_token_secret_arn: str,
    channel_id: str,
    messages: list[dict[str, Any]],
    interval_seconds: float = 1.0,
) -> list[dict[str, str | None]]:
    """Post multiple messages to Slack with rate limiting.

    Args:
        bot_token_secret_arn: Secrets Manager ARN for Bot Token.
        channel_id: Slack channel ID.
        messages: List of dicts with 'blocks' and optional 'arxiv_id'.
        interval_seconds: Delay between messages.

    Returns:
        List of {arxiv_id, ts} for each message.
    """
    bot_token = _get_secret(bot_token_secret_arn)
    results: list[dict[str, str | None]] = []

    for i, msg in enumerate(messages):
        blocks = msg.get("blocks", [])
        ts = post_message(bot_token, channel_id, blocks)
        results.append({
            "arxiv_id": msg.get("arxiv_id"),
            "ts": ts,
        })
        if i < len(messages) - 1:
            time.sleep(interval_seconds)

    success_count = sum(1 for r in results if r["ts"])
    logger.info("Posted %d/%d messages to Slack", success_count, len(messages))
    return results
