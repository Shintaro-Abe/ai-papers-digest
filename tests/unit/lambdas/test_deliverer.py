"""Tests for deliverer Lambda components."""

from src.lambdas.deliverer.message_builder import (
    build_header_message,
    build_paper_message,
    format_tags,
)


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

        # Section block
        text = blocks[0]["text"]["text"]
        assert "Scaling Laws" in text
        assert "スケーリング則" in text
        assert "`LLM`" in text

        # Actions block
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
