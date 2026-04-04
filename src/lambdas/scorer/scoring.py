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


def compute_category_preferences(
    feedback: list[dict[str, Any]],
    paper_map: dict[str, dict[str, Any]],
) -> dict[str, float]:
    """Build category preference profile from feedback history.

    For each arXiv category, compute a preference score based on
    like/dislike ratio with Laplace smoothing.

    Returns:
        Dict mapping category to preference score in [0.0, 1.0].
    """
    cat_likes: dict[str, int] = {}
    cat_total: dict[str, int] = {}

    for fb in feedback:
        paper = paper_map.get(fb.get("arxiv_id", ""))
        if not paper:
            continue
        categories = paper.get("categories", [])
        if not isinstance(categories, list):
            continue
        reaction = fb.get("reaction", "")
        for cat in categories:
            cat_total[cat] = cat_total.get(cat, 0) + 1
            if reaction == "like":
                cat_likes[cat] = cat_likes.get(cat, 0) + 1

    # Laplace smoothing: (likes + 1) / (total + 2)
    preferences: dict[str, float] = {}
    for cat, total in cat_total.items():
        likes = cat_likes.get(cat, 0)
        preferences[cat] = (likes + 1) / (total + 2)

    return preferences


def compute_feedback_bonus(
    paper: dict[str, Any],
    preferences: dict[str, float],
) -> float:
    """Compute feedback bonus for a paper based on category preferences.

    Returns average preference score for the paper's categories.
    Returns 0.0 if no preferences or no categories.
    """
    categories = paper.get("categories", [])
    if not isinstance(categories, list) or not categories or not preferences:
        return 0.0

    scores = [preferences.get(cat, 0.0) for cat in categories]
    matched = [s for s in scores if s > 0.0]
    if not matched:
        return 0.0
    return sum(matched) / len(matched)


def calculate_scores(
    papers: list[dict[str, Any]],
    weights: dict[str, float],
    feedback_data: list[dict[str, Any]] | None = None,
    paper_lookup: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Calculate attention scores for all papers.

    Args:
        papers: List of paper dicts with hf_upvotes, s2_citation_count, source_count.
        weights: Dict with w1, w2, w3, w4 keys.
        feedback_data: Optional list of feedback records for feedback_bonus.
        paper_lookup: Optional dict of arxiv_id -> paper for feedback lookup.

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

    # Compute feedback bonuses if data is available
    preferences: dict[str, float] = {}
    if feedback_data and paper_lookup:
        preferences = compute_category_preferences(feedback_data, paper_lookup)

    bonus_vals = [compute_feedback_bonus(p, preferences) for p in papers]

    for i, paper in enumerate(papers):
        score = (
            w1 * normalize(float(paper.get("hf_upvotes", 0)), hf_vals)
            + w2 * normalize(float(paper.get("s2_citation_count", 0)), s2_vals)
            + w3 * normalize(float(paper.get("source_count", 1)), src_vals)
            + w4 * normalize(bonus_vals[i], bonus_vals)
        )
        paper["score"] = round(score, 4)

    papers.sort(key=lambda p: p["score"], reverse=True)
    return papers
