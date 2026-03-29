"""Paper scoring logic."""

from typing import Any

EPSILON = 1e-10


def normalize(x: float, values: list[float]) -> float:
    """Min-max normalize a value within a list."""
    if not values:
        return 0.0
    min_v = min(values)
    max_v = max(values)
    if max_v - min_v < EPSILON:
        return 0.0
    return (x - min_v) / (max_v - min_v)


def calculate_scores(papers: list[dict[str, Any]], weights: dict[str, float]) -> list[dict[str, Any]]:
    """Calculate attention scores for all papers.

    Args:
        papers: List of paper dicts with hf_upvotes, s2_citation_count, source_count.
        weights: Dict with w1, w2, w3, w4 keys.

    Returns:
        Papers with 'score' field added, sorted by score descending.
    """
    hf_vals = [float(p.get("hf_upvotes", 0)) for p in papers]
    s2_vals = [float(p.get("s2_citation_count", 0)) for p in papers]
    src_vals = [float(p.get("source_count", 1)) for p in papers]

    w1 = weights.get("w1", 0.4)
    w2 = weights.get("w2", 0.2)
    w3 = weights.get("w3", 0.2)
    w4 = weights.get("w4", 0.2)

    for paper in papers:
        score = (
            w1 * normalize(float(paper.get("hf_upvotes", 0)), hf_vals)
            + w2 * normalize(float(paper.get("s2_citation_count", 0)), s2_vals)
            + w3 * normalize(float(paper.get("source_count", 1)), src_vals)
            + w4 * 0.0  # feedback_bonus: Phase 2
        )
        paper["score"] = round(score, 4)

    papers.sort(key=lambda p: p["score"], reverse=True)
    return papers
