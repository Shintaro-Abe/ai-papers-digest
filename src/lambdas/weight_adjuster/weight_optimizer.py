"""Scoring weight optimization based on feedback data."""

import logging
from typing import Any

logger = logging.getLogger(__name__)

MIN_WEIGHT = 0.05
MIN_FEEDBACK_COUNT = 5
LEARNING_RATE = 0.3
SMOOTHING_STRENGTH = 5
WEIGHT_KEYS = ["w1", "w2", "w3", "w4"]

# Feature extractors: map weight key to the paper field used for scoring
WEIGHT_FEATURES = {
    "w1": "hf_upvotes",
    "w2": "s2_citation_count",
    "w3": "source_count",
    "w4": "categories",
}


def compute_predictive_power(
    liked_papers: list[dict[str, Any]],
    disliked_papers: list[dict[str, Any]],
    all_papers: list[dict[str, Any]],
    feature_key: str,
) -> float:
    """Compute how well a numeric feature predicts Like vs Dislike.

    Uses Bayesian smoothing to stabilize estimates with small samples.
    Returns a score between 0.0 and 1.0 indicating predictive power.
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

    # Bayesian smoothing: blend toward neutral prior (1.0) based on sample size
    n = len(liked_papers)
    prior = 1.0
    smoothed_ratio = (liked_avg * n + prior * SMOOTHING_STRENGTH) / (
        all_avg * n + SMOOTHING_STRENGTH + 1e-10
    )

    # Mild penalty for disliked correlation
    if disliked_avg > 0:
        penalty = disliked_avg / (all_avg + 1e-10)
        smoothed_ratio = smoothed_ratio - (penalty * 0.3)

    return max(0.0, min(1.0, smoothed_ratio / 2.0))


def compute_category_predictive_power(
    liked_papers: list[dict[str, Any]],
    disliked_papers: list[dict[str, Any]],
    all_papers: list[dict[str, Any]],
) -> float:
    """Compute how well category preferences predict Like vs Dislike.

    Measures whether liked papers share categories more than random.
    Returns a score between 0.0 and 1.0.
    """
    if not liked_papers or not all_papers:
        return 0.5

    # Build liked category profile
    liked_cats: dict[str, int] = {}
    for p in liked_papers:
        for cat in p.get("categories", []):
            liked_cats[cat] = liked_cats.get(cat, 0) + 1

    if not liked_cats:
        return 0.5

    # Build disliked category profile
    disliked_cats: dict[str, int] = {}
    for p in disliked_papers:
        for cat in p.get("categories", []):
            disliked_cats[cat] = disliked_cats.get(cat, 0) + 1

    # For each liked paper, compute overlap with liked category profile
    def category_overlap(paper: dict[str, Any]) -> float:
        cats = paper.get("categories", [])
        if not cats:
            return 0.0
        return sum(liked_cats.get(c, 0) for c in cats) / (len(cats) * len(liked_papers))

    liked_overlap = sum(category_overlap(p) for p in liked_papers) / len(liked_papers)
    all_overlap = sum(category_overlap(p) for p in all_papers) / len(all_papers)

    if all_overlap < 1e-10:
        return 0.5

    # Bayesian smoothing
    n = len(liked_papers)
    prior = 1.0
    ratio = (liked_overlap * n + prior * SMOOTHING_STRENGTH) / (
        all_overlap * n + SMOOTHING_STRENGTH + 1e-10
    )

    # Dislike penalty
    if disliked_cats:
        disliked_overlap = sum(category_overlap(p) for p in disliked_papers) / max(len(disliked_papers), 1)
        if all_overlap > 1e-10:
            penalty = disliked_overlap / (all_overlap + 1e-10)
            ratio = ratio - (penalty * 0.3)

    return max(0.0, min(1.0, ratio / 2.0))


def optimize_weights(
    feedback: list[dict[str, Any]],
    papers: list[dict[str, Any]],
    current_weights: dict[str, float],
) -> dict[str, float]:
    """Optimize scoring weights based on accumulated feedback.

    Uses Bayesian smoothing and EMA blending for stability with small samples.
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

    total_feedback = len(liked_papers) + len(disliked_papers)

    if not liked_papers:
        logger.info("No liked papers found, keeping current weights")
        return current_weights

    if total_feedback < MIN_FEEDBACK_COUNT:
        logger.info(
            "Insufficient feedback (%d < %d), keeping current weights",
            total_feedback,
            MIN_FEEDBACK_COUNT,
        )
        return current_weights

    logger.info(
        "Optimizing weights: %d liked, %d disliked, %d total papers",
        len(liked_papers),
        len(disliked_papers),
        len(papers),
    )

    # Compute predictive power for each feature
    raw_scores: dict[str, float] = {}
    for weight_key, feature_key in WEIGHT_FEATURES.items():
        if feature_key == "categories":
            raw_scores[weight_key] = compute_category_predictive_power(
                liked_papers, disliked_papers, papers
            )
        else:
            raw_scores[weight_key] = compute_predictive_power(
                liked_papers, disliked_papers, papers, feature_key
            )

    logger.info("Raw predictive scores: %s", raw_scores)

    # Normalize raw scores
    new_raw = _normalize_weights(raw_scores)

    # EMA blending: gradual transition from current to new weights
    blended: dict[str, float] = {}
    for key in WEIGHT_KEYS:
        old = current_weights.get(key, 0.25)
        new = new_raw.get(key, 0.25)
        blended[key] = (1 - LEARNING_RATE) * old + LEARNING_RATE * new

    # Normalize blended result
    new_weights = _normalize_weights(blended)

    logger.info("Optimized weights: %s (previous: %s)", new_weights, current_weights)
    return new_weights


def _normalize_weights(raw: dict[str, float]) -> dict[str, float]:
    """Normalize weights to sum 1.0 with minimum constraint."""
    n = len(WEIGHT_KEYS)
    total = sum(raw.values())
    if total == 0:
        return {k: round(1.0 / n, 4) for k in WEIGHT_KEYS}

    normalized = {k: v / total for k, v in raw.items()}

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

    result = {k: round(v, 4) for k, v in normalized.items()}
    diff = round(1.0 - sum(result.values()), 4)
    if abs(diff) > 0.0001:
        max_key = max(result, key=lambda k: result[k])
        result[max_key] = round(result[max_key] + diff, 4)

    return result
