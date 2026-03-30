"""Hugging Face Papers API client."""

import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)

HF_API_BASE = "https://huggingface.co/api"


def fetch_daily_papers(date: str) -> list[dict[str, Any]]:
    """Fetch daily papers from Hugging Face API.

    Args:
        date: Date string in YYYY-MM-DD format.

    Returns:
        List of paper dicts with normalized fields.
    """
    url = f"{HF_API_BASE}/daily_papers"
    params = {"date": date}

    try:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        raw_papers = resp.json()
    except Exception:
        logger.exception("Failed to fetch HF daily papers for date=%s", date)
        return []

    papers: list[dict[str, Any]] = []
    for item in raw_papers:
        paper_data = item.get("paper", {})
        arxiv_id = paper_data.get("id")
        if not arxiv_id:
            continue

        papers.append(
            {
                "arxiv_id": arxiv_id,
                "title": paper_data.get("title", ""),
                "abstract": paper_data.get("summary", ""),
                "authors": [a.get("name", "") for a in paper_data.get("authors", [])],
                "published_date": paper_data.get("publishedAt", ""),
                "hf_upvotes": paper_data.get("upvotes", 0),
                "hf_ai_summary": paper_data.get("ai_summary", ""),
                "hf_ai_keywords": paper_data.get("ai_keywords", []),
                "github_repo": paper_data.get("githubRepo", ""),
                "source": "huggingface",
            }
        )

    logger.info("Fetched %d papers from HF daily papers (date=%s)", len(papers), date)
    return papers
