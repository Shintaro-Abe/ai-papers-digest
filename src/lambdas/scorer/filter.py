"""Paper filtering logic."""

from typing import Any


def filter_papers(
    scored_papers: list[dict[str, Any]],
    delivered_ids: set[str],
    top_n: int = 7,
) -> list[dict[str, Any]]:
    """Filter scored papers: exclude delivered, return top N.

    Args:
        scored_papers: Papers with 'score' field, sorted by score desc.
        delivered_ids: Set of arXiv IDs already delivered.
        top_n: Number of papers to select.

    Returns:
        Top N undelivered papers.
    """
    candidates = [p for p in scored_papers if p["arxiv_id"] not in delivered_ids]
    return candidates[:top_n]
