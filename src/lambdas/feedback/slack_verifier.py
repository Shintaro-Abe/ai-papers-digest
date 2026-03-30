"""Slack request signature verification."""

import hashlib
import hmac
import logging
import time

import boto3

logger = logging.getLogger(__name__)


def _get_signing_secret(secret_arn: str) -> str:
    """Retrieve Slack Signing Secret from Secrets Manager."""
    client = boto3.client("secretsmanager")
    resp = client.get_secret_value(SecretId=secret_arn)
    return resp["SecretString"]


def verify_signature(
    signing_secret: str,
    timestamp: str,
    body: str,
    signature: str,
) -> bool:
    """Verify Slack request signature.

    See: https://api.slack.com/authentication/verifying-requests-from-slack

    Args:
        signing_secret: Slack app signing secret.
        timestamp: X-Slack-Request-Timestamp header value.
        body: Raw request body string.
        signature: X-Slack-Signature header value.

    Returns:
        True if signature is valid.
    """
    # Reject requests older than 5 minutes (replay attack protection)
    try:
        ts = int(timestamp)
    except (ValueError, TypeError):
        logger.warning("Invalid timestamp: %s", timestamp)
        return False

    if abs(time.time() - ts) > 300:
        logger.warning("Request timestamp too old: %s", timestamp)
        return False

    # Compute expected signature
    sig_basestring = f"v0:{timestamp}:{body}"
    expected = "v0=" + hmac.new(
        signing_secret.encode("utf-8"),
        sig_basestring.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, signature)
