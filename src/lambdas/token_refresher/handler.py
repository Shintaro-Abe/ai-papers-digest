"""Lambda handler for Claude OAuth token refresh."""

import json
import logging
import os
from datetime import UTC, datetime, timedelta, timezone
from typing import Any
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

import boto3
from pipeline_runs import upsert_run_status

JST = timezone(timedelta(hours=9))


def _today_jst() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d")

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
SCOPES = "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"

# 5 minutes buffer (same as Claude CLI)
EXPIRY_BUFFER_MS = 300_000

secrets_client = boto3.client("secretsmanager")


def _get_credentials(secret_id: str) -> dict[str, Any]:
    """Load credentials from Secrets Manager."""
    resp = secrets_client.get_secret_value(SecretId=secret_id)
    return json.loads(resp["SecretString"])


def _save_credentials(secret_id: str, credentials: dict[str, Any]) -> None:
    """Save credentials to Secrets Manager."""
    secrets_client.put_secret_value(
        SecretId=secret_id,
        SecretString=json.dumps(credentials),
    )


def _refresh_token(refresh_token: str) -> dict[str, Any]:
    """Call Claude OAuth token endpoint to refresh the access token."""
    payload = json.dumps({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CLIENT_ID,
        "scope": SCOPES,
    }).encode("utf-8")

    req = Request(
        TOKEN_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Refresh Claude OAuth token and update Secrets Manager."""
    secret_id = os.environ["CLAUDE_SECRET_ID"]
    today = _today_jst()

    try:
        # 1. Load current credentials
        credentials = _get_credentials(secret_id)
        oauth = credentials.get("claudeAiOauth", {})

        expires_at = oauth.get("expiresAt", 0)
        now_ms = int(datetime.now(UTC).timestamp() * 1000)

        # 2. Check if refresh is needed (expired or expiring within 5 min)
        if now_ms + EXPIRY_BUFFER_MS < expires_at:
            remaining_min = (expires_at - now_ms) / 60_000
            logger.info("Token still valid for %.0f minutes, skipping refresh", remaining_min)
            upsert_run_status(today, "token_refresher", "skipped")
            return {"statusCode": 200, "body": "Token still valid"}

        logger.info("Token expired or expiring soon, refreshing...")

        # 3. Refresh
        refresh_token = oauth.get("refreshToken")
        if not refresh_token:
            logger.error("No refreshToken found in credentials")
            upsert_run_status(
                today, "token_refresher", "error", error="No refreshToken"
            )
            return {"statusCode": 500, "body": "No refreshToken"}

        try:
            result = _refresh_token(refresh_token)
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            logger.error("Token refresh HTTP %d: %s", e.code, body)
            upsert_run_status(
                today, "token_refresher", "error",
                error=f"HTTP {e.code}: {body}",
            )
            return {"statusCode": 500, "body": f"Refresh failed: HTTP {e.code}: {body}"}
        except URLError as e:
            logger.error("Token refresh request failed: %s", e)
            upsert_run_status(today, "token_refresher", "error", error=str(e))
            return {"statusCode": 500, "body": f"Refresh failed: {e}"}

        # 4. Update credentials
        new_oauth = {
            **oauth,
            "accessToken": result["access_token"],
            "refreshToken": result.get("refresh_token", refresh_token),
            "expiresAt": now_ms + result.get("expires_in", 7200) * 1000,
        }
        if "scope" in result:
            new_oauth["scopes"] = result["scope"].split(" ")

        new_credentials = {**credentials, "claudeAiOauth": new_oauth}
        _save_credentials(secret_id, new_credentials)

        logger.info("Token refreshed successfully. New expiry: %d minutes",
                    result.get("expires_in", 7200) / 60)
    except Exception as exc:
        upsert_run_status(today, "token_refresher", "error", error=str(exc))
        raise

    upsert_run_status(today, "token_refresher", "success")

    return {
        "statusCode": 200,
        "body": json.dumps({
            "refreshed": True,
            "expires_in_minutes": result.get("expires_in", 7200) / 60,
        }),
    }
