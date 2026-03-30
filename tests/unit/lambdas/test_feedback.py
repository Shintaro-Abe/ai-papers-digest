"""Tests for feedback Lambda components."""

import hashlib
import hmac
import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.lambdas.feedback.reaction_parser import REACTION_MAP, parse_reaction_event
from src.lambdas.feedback.slack_verifier import verify_signature


class TestVerifySignature:
    """Tests for Slack signature verification."""

    def _make_signature(self, secret: str, timestamp: str, body: str) -> str:
        sig_basestring = f"v0:{timestamp}:{body}"
        return "v0=" + hmac.new(
            secret.encode("utf-8"),
            sig_basestring.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def test_valid_signature(self) -> None:
        secret = "test_signing_secret"
        timestamp = str(int(time.time()))
        body = '{"type":"event_callback"}'
        signature = self._make_signature(secret, timestamp, body)

        assert verify_signature(secret, timestamp, body, signature) is True

    def test_invalid_signature(self) -> None:
        secret = "test_signing_secret"
        timestamp = str(int(time.time()))
        body = '{"type":"event_callback"}'

        assert verify_signature(secret, timestamp, body, "v0=invalid") is False

    def test_expired_timestamp(self) -> None:
        secret = "test_signing_secret"
        timestamp = str(int(time.time()) - 600)  # 10 minutes old
        body = '{"type":"event_callback"}'
        signature = self._make_signature(secret, timestamp, body)

        assert verify_signature(secret, timestamp, body, signature) is False

    def test_invalid_timestamp(self) -> None:
        assert verify_signature("secret", "not_a_number", "{}", "v0=x") is False


class TestParseReactionEvent:
    """Tests for reaction event parsing."""

    def test_thumbsup_reaction(self) -> None:
        event: dict[str, Any] = {
            "type": "reaction_added",
            "user": "U12345",
            "reaction": "+1",
            "item": {"type": "message", "channel": "C0AQAJC41LG", "ts": "1234567890.123456"},
        }
        result = parse_reaction_event(event)
        assert result is not None
        assert result["user_id"] == "U12345"
        assert result["reaction"] == "like"
        assert result["message_ts"] == "1234567890.123456"
        assert result["event_type"] == "reaction_added"

    def test_thumbsdown_reaction(self) -> None:
        event: dict[str, Any] = {
            "type": "reaction_added",
            "user": "U12345",
            "reaction": "-1",
            "item": {"type": "message", "channel": "C0AQAJC41LG", "ts": "1234567890.123456"},
        }
        result = parse_reaction_event(event)
        assert result is not None
        assert result["reaction"] == "dislike"

    def test_irrelevant_reaction_ignored(self) -> None:
        event: dict[str, Any] = {
            "type": "reaction_added",
            "user": "U12345",
            "reaction": "heart",
            "item": {"type": "message", "channel": "C0AQAJC41LG", "ts": "1234567890.123456"},
        }
        result = parse_reaction_event(event)
        assert result is None

    def test_reaction_map_contents(self) -> None:
        assert REACTION_MAP["+1"] == "like"
        assert REACTION_MAP["thumbsup"] == "like"
        assert REACTION_MAP["-1"] == "dislike"
        assert REACTION_MAP["thumbsdown"] == "dislike"
