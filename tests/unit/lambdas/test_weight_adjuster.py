"""Tests for weight-adjuster Lambda components."""

from src.lambdas.weight_adjuster.weight_optimizer import (
    MIN_FEEDBACK_COUNT,
    MIN_WEIGHT,
    _normalize_weights,
    compute_category_predictive_power,
    compute_predictive_power,
    optimize_weights,
)


class TestComputePredictivePower:
    """Tests for compute_predictive_power function."""

    def test_liked_papers_have_higher_feature(self) -> None:
        liked = [{"hf_upvotes": 100}, {"hf_upvotes": 80}]
        disliked = [{"hf_upvotes": 10}]
        all_papers = [{"hf_upvotes": 100}, {"hf_upvotes": 80}, {"hf_upvotes": 10}, {"hf_upvotes": 20}]

        score = compute_predictive_power(liked, disliked, all_papers, "hf_upvotes")
        assert score > 0.5  # High predictive power

    def test_bayesian_smoothing_with_small_sample(self) -> None:
        """With only 1 liked paper, smoothing pulls score toward neutral 0.5."""
        liked = [{"hf_upvotes": 60}]
        all_papers = [{"hf_upvotes": 60}, {"hf_upvotes": 40}, {"hf_upvotes": 50}]
        score = compute_predictive_power(liked, [], all_papers, "hf_upvotes")
        # Smoothing moderates the score — should not be extreme
        assert 0.3 < score < 0.8

    def test_no_difference(self) -> None:
        papers = [{"hf_upvotes": 50}, {"hf_upvotes": 50}]
        score = compute_predictive_power(papers, [], papers, "hf_upvotes")
        assert abs(score - 0.5) < 0.1  # Near neutral with smoothing

    def test_no_liked_papers(self) -> None:
        score = compute_predictive_power([], [{"hf_upvotes": 10}], [{"hf_upvotes": 10}], "hf_upvotes")
        assert score == 0.5  # No data

    def test_all_zero_values(self) -> None:
        papers = [{"hf_upvotes": 0}, {"hf_upvotes": 0}]
        score = compute_predictive_power(papers, [], papers, "hf_upvotes")
        assert score == 0.5


class TestComputeCategoryPredictivePower:
    """Tests for compute_category_predictive_power function."""

    def test_liked_papers_share_categories(self) -> None:
        liked = [
            {"categories": ["cs.AI", "cs.CL"]},
            {"categories": ["cs.AI", "cs.LG"]},
        ]
        disliked = [{"categories": ["cs.CV"]}]
        all_papers = liked + disliked + [{"categories": ["cs.CV", "cs.RO"]}]
        score = compute_category_predictive_power(liked, disliked, all_papers)
        assert score > 0.5  # Category overlap is predictive

    def test_no_liked_papers(self) -> None:
        score = compute_category_predictive_power([], [{"categories": ["cs.AI"]}], [{"categories": ["cs.AI"]}])
        assert score == 0.5

    def test_no_categories(self) -> None:
        liked = [{"categories": []}]
        all_papers = [{"categories": []}]
        score = compute_category_predictive_power(liked, [], all_papers)
        assert score == 0.5


class TestNormalizeWeights:
    """Tests for _normalize_weights function."""

    def test_sums_to_one(self) -> None:
        raw = {"w1": 0.6, "w2": 0.3, "w3": 0.2, "w4": 0.1}
        result = _normalize_weights(raw)
        assert abs(sum(result.values()) - 1.0) < 0.001

    def test_minimum_weight_enforced(self) -> None:
        raw = {"w1": 0.9, "w2": 0.0, "w3": 0.0, "w4": 0.0}
        result = _normalize_weights(raw)
        for key in result:
            assert result[key] >= MIN_WEIGHT

    def test_all_zeros(self) -> None:
        raw = {"w1": 0.0, "w2": 0.0, "w3": 0.0, "w4": 0.0}
        result = _normalize_weights(raw)
        assert abs(sum(result.values()) - 1.0) < 0.001
        assert result["w1"] == 0.25

    def test_equal_inputs(self) -> None:
        raw = {"w1": 0.5, "w2": 0.5, "w3": 0.5, "w4": 0.5}
        result = _normalize_weights(raw)
        assert abs(sum(result.values()) - 1.0) < 0.001
        for v in result.values():
            assert abs(v - 0.25) < 0.01


class TestOptimizeWeights:
    """Tests for optimize_weights function."""

    def test_no_feedback_keeps_current(self) -> None:
        current = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}
        result = optimize_weights([], [], current)
        assert result == current

    def test_no_liked_papers_keeps_current(self) -> None:
        current = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}
        feedback = [{"arxiv_id": "001", "reaction": "dislike"}]
        papers = [{"arxiv_id": "001", "hf_upvotes": 10, "s2_citation_count": 5, "source_count": 2}]
        result = optimize_weights(feedback, papers, current)
        assert result == current

    def test_with_feedback_changes_weights(self) -> None:
        current = {"w1": 0.25, "w2": 0.25, "w3": 0.25, "w4": 0.25}
        feedback = [
            {"arxiv_id": "001", "reaction": "like"},
            {"arxiv_id": "002", "reaction": "like"},
            {"arxiv_id": "003", "reaction": "like"},
            {"arxiv_id": "004", "reaction": "dislike"},
            {"arxiv_id": "005", "reaction": "dislike"},
        ]
        papers = [
            {"arxiv_id": "001", "hf_upvotes": 100, "s2_citation_count": 5, "source_count": 3, "categories": ["cs.AI"]},
            {"arxiv_id": "002", "hf_upvotes": 80, "s2_citation_count": 3, "source_count": 2, "categories": ["cs.AI"]},
            {"arxiv_id": "003", "hf_upvotes": 90, "s2_citation_count": 2, "source_count": 3, "categories": ["cs.CL"]},
            {"arxiv_id": "004", "hf_upvotes": 5, "s2_citation_count": 50, "source_count": 1, "categories": ["cs.CV"]},
            {"arxiv_id": "005", "hf_upvotes": 10, "s2_citation_count": 40, "source_count": 1, "categories": ["cs.CV"]},
            {"arxiv_id": "006", "hf_upvotes": 20, "s2_citation_count": 10, "source_count": 1, "categories": ["cs.AI"]},
        ]
        result = optimize_weights(feedback, papers, current)

        # Weights should sum to 1.0
        assert abs(sum(result.values()) - 1.0) < 0.001
        # All weights should be >= MIN_WEIGHT
        for v in result.values():
            assert v >= MIN_WEIGHT

    def test_insufficient_feedback_keeps_current(self) -> None:
        current = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}
        feedback = [
            {"arxiv_id": "001", "reaction": "like"},
            {"arxiv_id": "002", "reaction": "dislike"},
        ]
        papers = [
            {"arxiv_id": "001", "hf_upvotes": 100, "s2_citation_count": 5, "source_count": 3, "categories": ["cs.AI"]},
            {"arxiv_id": "002", "hf_upvotes": 5, "s2_citation_count": 50, "source_count": 1, "categories": ["cs.CV"]},
        ]
        result = optimize_weights(feedback, papers, current)
        assert result == current  # Below MIN_FEEDBACK_COUNT

    def test_ema_blending_prevents_large_swings(self) -> None:
        current = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}
        feedback = [
            {"arxiv_id": f"{i:03d}", "reaction": "like"}
            for i in range(5)
        ] + [{"arxiv_id": "010", "reaction": "dislike"}]
        papers = [
            {"arxiv_id": f"{i:03d}", "hf_upvotes": 100, "s2_citation_count": 0, "source_count": 1, "categories": ["cs.AI"]}
            for i in range(5)
        ] + [{"arxiv_id": "010", "hf_upvotes": 0, "s2_citation_count": 100, "source_count": 1, "categories": ["cs.CV"]}]
        result = optimize_weights(feedback, papers, current)

        # EMA blending: new weights should not deviate drastically from current
        for key in current:
            assert abs(result[key] - current[key]) < 0.15

    def test_feedback_for_unknown_paper_ignored(self) -> None:
        current = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}
        feedback = [{"arxiv_id": "999", "reaction": "like"}]
        papers = [{"arxiv_id": "001", "hf_upvotes": 10, "s2_citation_count": 5, "source_count": 2}]
        result = optimize_weights(feedback, papers, current)
        assert result == current  # No matching paper, keeps current
