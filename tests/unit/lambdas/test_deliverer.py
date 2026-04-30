"""Tests for deliverer Lambda components."""

from unittest.mock import MagicMock, patch

from src.lambdas.deliverer.message_builder import (
    build_header_message,
    build_paper_message,
    format_tags,
)
from src.lambdas.deliverer.slack_client import post_message


class TestFormatTags:
    """Tests for format_tags function."""

    def test_multiple_tags(self) -> None:
        assert format_tags(["LLM", "Transformer"]) == "`LLM` `Transformer`"

    def test_single_tag(self) -> None:
        assert format_tags(["Vision"]) == "`Vision`"

    def test_empty_tags(self) -> None:
        assert format_tags([]) == ""


class TestBuildHeaderMessage:
    """Tests for build_header_message function."""

    def test_header_structure(self) -> None:
        msg = build_header_message("2026-03-27", 7, "https://example.com/digest/2026-03-27.html")

        assert len(msg["blocks"]) == 3
        assert msg["blocks"][0]["type"] == "header"
        assert "2026-03-27" in msg["blocks"][0]["text"]["text"]
        assert "7本" in msg["blocks"][1]["text"]["text"]


class TestBuildPaperMessage:
    """Tests for build_paper_message function."""

    def test_paper_message_structure(self) -> None:
        summary = {
            "arxiv_id": "2603.18718",
            "title_original": "Scaling Laws for Neural Language Models",
            "title_ja": "ニューラル言語モデルのスケーリング則",
            "compact_summary": "言語モデルの性能はモデルサイズに対してべき乗則に従うことを実証した研究。",
            "tags": ["LLM", "Scaling"],
        }
        detail_url = "https://example.com/papers/2603.18718.html"

        msg = build_paper_message(summary, detail_url)

        blocks = msg["blocks"]
        assert len(blocks) == 3  # section, actions, divider

        text = blocks[0]["text"]["text"]
        assert "Scaling Laws" in text
        assert "スケーリング則" in text
        assert "`LLM`" in text

        buttons = blocks[1]["elements"]
        assert len(buttons) == 2
        assert buttons[0]["url"] == detail_url
        assert "2603.18718" in buttons[1]["url"]

    def test_paper_message_without_optional_fields(self) -> None:
        summary = {
            "arxiv_id": "2603.99999",
            "title_original": "Test Paper",
            "title_ja": "",
            "compact_summary": "Test summary.",
            "tags": [],
        }

        msg = build_paper_message(summary, "https://example.com/papers/2603.99999.html")
        text = msg["blocks"][0]["text"]["text"]
        assert "Test Paper" in text

    def test_paper_message_with_hf_upvotes_badge(self) -> None:
        summary = {
            "arxiv_id": "2604.25917",
            "title_original": "Recursive Multi-Agent Systems",
            "title_ja": "",
            "compact_summary": "summary",
            "tags": [],
        }
        msg = build_paper_message(
            summary, "https://example.com/papers/2604.25917.html", hf_upvotes=121
        )
        text = msg["blocks"][0]["text"]["text"]
        assert "🤗" in text
        assert "HF Daily Papers" in text
        assert "121 upvotes" in text

    def test_paper_message_no_badge_when_zero_upvotes(self) -> None:
        summary = {
            "arxiv_id": "2604.99999",
            "title_original": "ArXiv-only Paper",
            "title_ja": "",
            "compact_summary": "summary",
            "tags": [],
        }
        msg = build_paper_message(
            summary, "https://example.com/papers/2604.99999.html", hf_upvotes=0
        )
        text = msg["blocks"][0]["text"]["text"]
        assert "🤗" not in text
        assert "HF Daily Papers" not in text


class TestPostMessage:
    """Tests for slack_client.post_message (chat.postMessage)."""

    @patch("src.lambdas.deliverer.slack_client.requests.post")
    def test_post_message_success(self, mock_post: MagicMock) -> None:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"ok": True, "ts": "1234567890.123456"}
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        ts = post_message("xoxb-test", "C0TEST", [{"type": "section", "text": {"type": "mrkdwn", "text": "test"}}])

        assert ts == "1234567890.123456"
        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args
        assert call_kwargs[1]["json"]["channel"] == "C0TEST"
        assert "Bearer xoxb-test" in call_kwargs[1]["headers"]["Authorization"]

    @patch("src.lambdas.deliverer.slack_client.requests.post")
    def test_post_message_api_error(self, mock_post: MagicMock) -> None:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"ok": False, "error": "channel_not_found"}
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        ts = post_message("xoxb-test", "C0INVALID", [])
        assert ts is None

    @patch("src.lambdas.deliverer.slack_client.requests.post")
    def test_post_message_network_error(self, mock_post: MagicMock) -> None:
        mock_post.side_effect = Exception("Connection error")
        ts = post_message("xoxb-test", "C0TEST", [])
        assert ts is None
