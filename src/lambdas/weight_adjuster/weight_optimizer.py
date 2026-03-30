"""Scoring weight optimization based on feedback data."""

import logging
from typing import Any

logger = logging.getLogger(__name__)

MIN_WEIGHT = 0.05
WEIGHT_KEYS = ["w1", "w2", "w3", "w4"]

# Feature extractors: map weight key to the paper field used for scoring
WEIGHT_FEATURES = {
    "w1": "hf_upvotes",
    "w2": "s2_citation_count",
    "w3": "source_count",
    "w4": None,  # feedback_bonus - not adjustable by this optimizer
}


def compute_predictive_power(
    liked_papers: list[dict[str, Any]],
    disliked_papers: list[dict[str, Any]],
    all_papers: list[dict[str, Any]],
    feature_key: str,
) -> float:
    """Compute how well a feature predicts Like vs Dislike.

    Returns a score between 0.0 and 1.0 indicating predictive power.
    Higher = liked papers tend to have higher values of this feature.
    """
    if not liked_papers or not all_papers:
        return 0.5  # No data, neutral

    def avg_feature(papers: list[dict[str, Any]]) -> float:
        values = [float(p.get(feature_key, 0)) for p in papers]
        return sum(values) / len(values) if values else 0.0

    liked_avg = avg_feature(liked_papers)
    disliked_avg = avg_feature(disliked_papers) if disliked_papers else 0.0
    all_avg = avg_feature(all_papers)

    if all_avg == 0:
        return 0.5

    # Ratio: how much higher liked papers score vs overall average
    # Clamp to [0, 1] range
    ratio = liked_avg / (all_avg + 1e-10)
    # Also factor in dislike penalty
    if disliked_avg > 0:
        penalty = disliked_avg / (all_avg + 1e-10)
        ratio = ratio - (penalty * 0.3)  # Mild penalty for disliked correlation

    return max(0.0, min(1.0, ratio / 2.0))


def optimize_weights(
    feedback: list[dict[str, Any]],
    papers: list[dict[str, Any]],
    current_weights: dict[str, float],
) -> dict[str, float]:
    """Optimize scoring weights based on accumulated feedback.

    Args:
        feedback: List of feedback records with {arxiv_id, reaction}.
        papers: List of paper records with scoring features.
        current_weights: Current weight values.

    Returns:
        New optimized weights (sum = 1.0, each >= MIN_WEIGHT).
    """
    if not feedback or not papers:
        logger.info("Insufficient data for weight optimization, keeping current weights")
        return current_weights

    # Build paper lookup
    paper_map = {p["arxiv_id"]: p for p in papers if "arxiv_id" in p}

    # Split feedback into liked/disliked papers
    liked_papers = []
    disliked_papers = []
    for fb in feedback:
        paper = paper_map.get(fb.get("arxiv_id", ""))
        if not paper:
            continue
        if fb.get("reaction") == "like":
            liked_papers.append(paper)
        elif fb.get("reaction") == "dislike":
            disliked_papers.append(paper)

    if not liked_papers:
        logger.info("No liked papers found, keeping current weights")
        return current_weights

    logger.info(
        "Optimizing weights: %d liked, %d disliked, %d total papers",
        len(liked_papers), len(disliked_papers), len(papers),
    )

    # Compute predictive power for each adjustable feature
    raw_scores: dict[str, float] = {}
    for weight_key, feature_key in WEIGHT_FEATURES.items():
        if feature_key is None:
            # w4 (feedback_bonus) keeps its current weight
            raw_scores[weight_key] = current_weights.get(weight_key, 0.2)
        else:
            raw_scores[weight_key] = compute_predictive_power(
                liked_papers, disliked_papers, papers, feature_key
            )

    logger.info("Raw predictive scores: %s", raw_scores)

    # Normalize to sum = 1.0 with minimum weight constraint
    new_weights = _normalize_weights(raw_scores)

    logger.info("Optimized weights: %s (previous: %s)", new_weights, current_weights)
    return new_weights


def _normalize_weights(raw: dict[str, float]) -> dict[str, float]:
    """Normalize weights to sum 1.0 with minimum constraint.

    Uses iterative redistribution to ensure all weights >= MIN_WEIGHT.
    """
    n = len(WEIGHT_KEYS)
    total = sum(raw.values())
    if total == 0:
        return {k: round(1.0 / n, 4) for k in WEIGHT_KEYS}

    # First pass: normalize
    normalized = {k: v / total for k, v in raw.items()}

    # Iteratively enforce minimum: clamp small weights up,
    # then redistribute the excess from larger weights
    for _ in range(10):
        below = {k: v for k, v in normalized.items() if v < MIN_WEIGHT}
        if not below:
            break
        above = {k: v for k, v in normalized.items() if v >= MIN_WEIGHT}
        deficit = sum(MIN_WEIGHT - v for v in below.values())
        above_total = sum(above.values())

        for k in below:
            normalized[k] = MIN_WEIGHT
        if above_total > 0:
            for k in above:
                normalized[k] = normalized[k] - (deficit * normalized[k] / above_total)

    # Round and fix sum
    result = {k: round(v, 4) for k, v in normalized.items()}
    diff = round(1.0 - sum(result.values()), 4)
    if abs(diff) > 0.0001:
        max_key = max(result, key=lambda k: result[k])
        result[max_key] = round(result[max_key] + diff, 4)

    return result
