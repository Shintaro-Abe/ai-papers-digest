"""Slack Incoming Webhook client."""

import logging
import time
from typing import Any

import boto3
import requests

logger = logging.getLogger(__name__)


def _get_webhook_url(secret_arn: str) -> str:
    """Retrieve Slack Webhook URL from Secrets Manager."""
    client = boto3.client("secretsmanager")
    resp = client.get_secret_value(SecretId=secret_arn)
    return resp["SecretString"]


def post_message(webhook_url: str, message: dict[str, Any]) -> bool:
    """Post a message to Slack via Incoming Webhook.

    Returns:
        True if successful, False otherwise.
    """
    try:
        resp = requests.post(webhook_url, json=message, timeout=10)
        resp.raise_for_status()
        return True
    except requests.RequestException:
        logger.exception("Failed to post Slack message")
        return False


def post_messages(
    secret_arn: str,
    messages: list[dict[str, Any]],
    interval_seconds: float = 1.0,
) -> int:
    """Post multiple messages to Slack with rate limiting.

    Args:
        secret_arn: Secrets Manager ARN for webhook URL.
        messages: List of Slack Block Kit message payloads.
        interval_seconds: Delay between messages.

    Returns:
        Number of successfully posted messages.
    """
    webhook_url = _get_webhook_url(secret_arn)
    success_count = 0

    for i, msg in enumerate(messages):
        if post_message(webhook_url, msg):
            success_count += 1
        if i < len(messages) - 1:
            time.sleep(interval_seconds)

    logger.info("Posted %d/%d messages to Slack", success_count, len(messages))
    return success_count
