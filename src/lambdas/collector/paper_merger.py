"""Paper data merger and deduplication."""

import logging
from typing import Any

logger = logging.getLogger(__name__)


def merge(hf_papers: list[dict[str, Any]], arxiv_papers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge papers from HF and arXiv, deduplicating by arXiv ID.

    HF papers take priority for metadata (they have upvotes, ai_summary).
    arXiv papers fill in any missing entries.

    Returns:
        Merged list of paper dicts.
    """
    merged: dict[str, dict[str, Any]] = {}

    for paper in hf_papers:
        arxiv_id = paper["arxiv_id"]
        merged[arxiv_id] = {**paper, "source_count": 1, "sources": ["huggingface"]}

    for paper in arxiv_papers:
        arxiv_id = paper["arxiv_id"]
        if arxiv_id in merged:
            existing = merged[arxiv_id]
            existing["source_count"] = 2
            existing["sources"].append("arxiv")
            if not existing.get("categories"):
                existing["categories"] = paper.get("categories", [])
            if not existing.get("authors"):
                existing["authors"] = paper.get("authors", [])
        else:
            merged[arxiv_id] = {
                **paper,
                "hf_upvotes": 0,
                "hf_ai_summary": "",
                "hf_ai_keywords": [],
                "github_repo": "",
                "source_count": 1,
                "sources": ["arxiv"],
            }

    result = list(merged.values())
    logger.info("Merged papers: %d HF + %d arXiv = %d unique", len(hf_papers), len(arxiv_papers), len(result))
    return result


def enrich(papers: list[dict[str, Any]], s2_data: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Enrich papers with Semantic Scholar data.

    Args:
        papers: Merged paper list.
        s2_data: Dict mapping arxiv_id to S2 metadata.

    Returns:
        Enriched paper list.
    """
    enriched_count = 0
    for paper in papers:
        arxiv_id = paper["arxiv_id"]
        s2 = s2_data.get(arxiv_id)
        if s2:
            paper["s2_citation_count"] = s2.get("s2_citation_count", 0)
            paper["s2_tldr"] = s2.get("s2_tldr", "")
            paper["source_count"] = paper.get("source_count", 1) + 1
            if "semantic_scholar" not in paper.get("sources", []):
                paper.setdefault("sources", []).append("semantic_scholar")
            enriched_count += 1
        else:
            paper.setdefault("s2_citation_count", 0)
            paper.setdefault("s2_tldr", "")

    logger.info("Enriched %d/%d papers with S2 data", enriched_count, len(papers))
    return papers
