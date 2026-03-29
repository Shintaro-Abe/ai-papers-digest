"""arXiv API client."""

import logging
import re
import time
from typing import Any

import feedparser

logger = logging.getLogger(__name__)

ARXIV_API_BASE = "https://export.arxiv.org/api/query"
RATE_LIMIT_SECONDS = 3
MAX_RESULTS_PER_CATEGORY = 50

ARXIV_ID_PATTERN = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?$")


def extract_arxiv_id(entry_id: str) -> str:
    """Extract arXiv ID from entry URL.

    Args:
        entry_id: Full arXiv URL (e.g., http://arxiv.org/abs/2603.18718v1).

    Returns:
        arXiv ID without version (e.g., 2603.18718).
    """
    match = ARXIV_ID_PATTERN.search(entry_id)
    return match.group(1) if match else entry_id.split("/")[-1]


def fetch_recent_papers(categories: list[str]) -> list[dict[str, Any]]:
    """Fetch recent papers from arXiv for given categories.

    Args:
        categories: List of arXiv category strings (e.g., ["cs.AI", "cs.CL"]).

    Returns:
        List of paper dicts with normalized fields.
    """
    papers: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for cat in categories:
        url = (
            f"{ARXIV_API_BASE}?search_query=cat:{cat}"
            f"&sortBy=submittedDate&sortOrder=descending"
            f"&max_results={MAX_RESULTS_PER_CATEGORY}"
        )

        try:
            feed = feedparser.parse(url)
            if feed.bozo and not feed.entries:
                logger.warning("Failed to parse arXiv feed for category=%s", cat)
                continue

            for entry in feed.entries:
                arxiv_id = extract_arxiv_id(entry.id)
                if arxiv_id in seen_ids:
                    continue
                seen_ids.add(arxiv_id)

                papers.append({
                    "arxiv_id": arxiv_id,
                    "title": entry.title.replace("\n", " ").strip(),
                    "abstract": entry.summary.replace("\n", " ").strip(),
                    "authors": [a.get("name", "") for a in entry.get("authors", [])],
                    "categories": [t.get("term", "") for t in entry.get("tags", [])],
                    "published_date": entry.get("published", ""),
                    "source": "arxiv",
                })

            logger.info("Fetched %d papers from arXiv category=%s", len(feed.entries), cat)
        except Exception:
            logger.exception("Error fetching arXiv category=%s", cat)

        time.sleep(RATE_LIMIT_SECONDS)

    logger.info("Total arXiv papers fetched: %d (unique)", len(papers))
    return papers
