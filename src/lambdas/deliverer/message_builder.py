"""Slack Block Kit message builder."""

from typing import Any


def format_tags(tags: list[str]) -> str:
    """Format tags as Slack inline code blocks."""
    return " ".join(f"`{tag}`" for tag in tags)


def build_header_message(date: str, paper_count: int, digest_url: str) -> dict[str, Any]:
    """Build the daily header message."""
    return {
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"📚 AI Papers Digest - {date}",
                },
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"本日の注目論文 *{paper_count}本* をお届けします。\n<{digest_url}|📋 ダイジェスト一覧を見る>",
                },
            },
            {"type": "divider"},
        ]
    }


def build_paper_message(summary: dict[str, Any], detail_page_url: str) -> dict[str, Any]:
    """Build a message for a single paper."""
    title_original = summary.get("title_original", summary.get("title", ""))
    title_ja = summary.get("title_ja", "")
    compact = summary.get("compact_summary", "")
    tags = summary.get("tags", [])
    arxiv_id = summary["arxiv_id"]

    text_parts = [f"*📄 {title_original}*"]
    if title_ja:
        text_parts.append(f"_{title_ja}_")
    text_parts.append("")
    text_parts.append(compact)
    if tags:
        text_parts.append("")
        text_parts.append(f"🏷️ {format_tags(tags)}")

    return {
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "\n".join(text_parts),
                },
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "📋 詳細を見る"},
                        "url": detail_page_url,
                        "style": "primary",
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "📖 arXiv"},
                        "url": f"https://arxiv.org/abs/{arxiv_id}",
                    },
                ],
            },
            {"type": "divider"},
        ]
    }
