"""Tests for scorer Lambda components."""

from src.lambdas.scorer.filter import filter_papers
from src.lambdas.scorer.scoring import (
    calculate_scores,
    compute_category_preferences,
    compute_feedback_bonus,
    normalize,
)


class TestNormalize:
    """Tests for normalize function."""

    def test_normal_range(self) -> None:
        assert normalize(5.0, [0.0, 10.0]) == 0.5

    def test_min_value(self) -> None:
        assert normalize(0.0, [0.0, 10.0]) == 0.0

    def test_max_value(self) -> None:
        assert normalize(10.0, [0.0, 10.0]) == 1.0

    def test_all_same_values(self) -> None:
        assert normalize(5.0, [5.0, 5.0, 5.0]) == 0.0

    def test_empty_values(self) -> None:
        assert normalize(5.0, []) == 0.0

    def test_single_value(self) -> None:
        assert normalize(5.0, [5.0]) == 0.0


class TestCalculateScores:
    """Tests for calculate_scores function."""

    def test_basic_scoring(self) -> None:
        papers = [
            {"arxiv_id": "001", "hf_upvotes": 100, "s2_citation_count": 10, "source_count": 3},
            {"arxiv_id": "002", "hf_upvotes": 0, "s2_citation_count": 0, "source_count": 1},
            {"arxiv_id": "003", "hf_upvotes": 50, "s2_citation_count": 5, "source_count": 2},
        ]
        weights = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}

        scored = calculate_scores(papers, weights)

        # Should be sorted by score descending
        assert scored[0]["arxiv_id"] == "001"
        assert scored[0]["score"] == 0.8  # 0.4*1.0 + 0.2*1.0 + 0.2*1.0 + 0
        assert scored[-1]["arxiv_id"] == "002"
        assert scored[-1]["score"] == 0.0

    def test_single_paper(self) -> None:
        papers = [{"arxiv_id": "001", "hf_upvotes": 50, "s2_citation_count": 10, "source_count": 2}]
        weights = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}

        scored = calculate_scores(papers, weights)
        assert scored[0]["score"] == 0.0  # All normalize to 0 with single value


class TestComputeCategoryPreferences:
    """Tests for compute_category_preferences function."""

    def test_single_like(self) -> None:
        feedback = [{"arxiv_id": "001", "reaction": "like"}]
        paper_map = {"001": {"categories": ["cs.AI", "cs.CL"]}}
        prefs = compute_category_preferences(feedback, paper_map)
        # Laplace: (1+1)/(1+2) = 0.667
        assert abs(prefs["cs.AI"] - 2 / 3) < 0.01
        assert abs(prefs["cs.CL"] - 2 / 3) < 0.01

    def test_mixed_feedback(self) -> None:
        feedback = [
            {"arxiv_id": "001", "reaction": "like"},
            {"arxiv_id": "002", "reaction": "dislike"},
        ]
        paper_map = {
            "001": {"categories": ["cs.AI"]},
            "002": {"categories": ["cs.AI"]},
        }
        prefs = compute_category_preferences(feedback, paper_map)
        # Laplace: (1+1)/(2+2) = 0.5
        assert abs(prefs["cs.AI"] - 0.5) < 0.01

    def test_empty_feedback(self) -> None:
        prefs = compute_category_preferences([], {})
        assert prefs == {}

    def test_unknown_paper_ignored(self) -> None:
        feedback = [{"arxiv_id": "unknown", "reaction": "like"}]
        paper_map = {"001": {"categories": ["cs.AI"]}}
        prefs = compute_category_preferences(feedback, paper_map)
        assert prefs == {}

    def test_multiple_categories(self) -> None:
        feedback = [
            {"arxiv_id": "001", "reaction": "like"},
            {"arxiv_id": "002", "reaction": "like"},
        ]
        paper_map = {
            "001": {"categories": ["cs.AI", "cs.CL"]},
            "002": {"categories": ["cs.AI", "cs.CV"]},
        }
        prefs = compute_category_preferences(feedback, paper_map)
        # cs.AI: (2+1)/(2+2) = 0.75, cs.CL: (1+1)/(1+2) = 0.667, cs.CV: same
        assert abs(prefs["cs.AI"] - 0.75) < 0.01
        assert abs(prefs["cs.CL"] - 2 / 3) < 0.01


class TestComputeFeedbackBonus:
    """Tests for compute_feedback_bonus function."""

    def test_matching_categories(self) -> None:
        paper = {"categories": ["cs.AI", "cs.CL"]}
        prefs = {"cs.AI": 0.8, "cs.CL": 0.6}
        bonus = compute_feedback_bonus(paper, prefs)
        assert abs(bonus - 0.7) < 0.01

    def test_no_matching_categories(self) -> None:
        paper = {"categories": ["cs.CV"]}
        prefs = {"cs.AI": 0.8}
        bonus = compute_feedback_bonus(paper, prefs)
        assert bonus == 0.0

    def test_empty_preferences(self) -> None:
        paper = {"categories": ["cs.AI"]}
        bonus = compute_feedback_bonus(paper, {})
        assert bonus == 0.0

    def test_no_categories(self) -> None:
        paper = {"categories": []}
        prefs = {"cs.AI": 0.8}
        bonus = compute_feedback_bonus(paper, prefs)
        assert bonus == 0.0


class TestCalculateScoresWithFeedback:
    """Tests for calculate_scores with feedback data."""

    def test_feedback_affects_scores(self) -> None:
        papers = [
            {"arxiv_id": "001", "hf_upvotes": 10, "s2_citation_count": 5, "source_count": 2, "categories": ["cs.AI"]},
            {"arxiv_id": "002", "hf_upvotes": 10, "s2_citation_count": 5, "source_count": 2, "categories": ["cs.CV"]},
        ]
        weights = {"w1": 0.25, "w2": 0.25, "w3": 0.25, "w4": 0.25}
        feedback = [{"arxiv_id": "old1", "reaction": "like"}]
        lookup = {"old1": {"categories": ["cs.AI"]}}

        scored = calculate_scores(papers, weights, feedback, lookup)
        ai_paper = next(p for p in scored if p["arxiv_id"] == "001")
        cv_paper = next(p for p in scored if p["arxiv_id"] == "002")
        # cs.AI paper should score higher due to feedback bonus
        assert ai_paper["score"] >= cv_paper["score"]

    def test_without_feedback_backward_compatible(self) -> None:
        papers = [
            {"arxiv_id": "001", "hf_upvotes": 100, "s2_citation_count": 10, "source_count": 3},
            {"arxiv_id": "002", "hf_upvotes": 0, "s2_citation_count": 0, "source_count": 1},
        ]
        weights = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}
        scored = calculate_scores(papers, weights)
        assert scored[0]["arxiv_id"] == "001"


class TestFilterPapers:
    """Tests for filter_papers function."""

    def test_excludes_delivered(self) -> None:
        papers = [
            {"arxiv_id": "001", "score": 0.9},
            {"arxiv_id": "002", "score": 0.8},
            {"arxiv_id": "003", "score": 0.7},
        ]
        delivered = {"001"}

        result = filter_papers(papers, delivered, top_n=3)

        assert len(result) == 2
        assert result[0]["arxiv_id"] == "002"
        assert result[1]["arxiv_id"] == "003"

    def test_top_n_limit(self) -> None:
        papers = [
            {"arxiv_id": f"{i:03d}", "score": 1.0 - i * 0.1}
            for i in range(10)
        ]

        result = filter_papers(papers, set(), top_n=3)

        assert len(result) == 3
        assert result[0]["arxiv_id"] == "000"

    def test_empty_after_filtering(self) -> None:
        papers = [{"arxiv_id": "001", "score": 0.9}]
        delivered = {"001"}

        result = filter_papers(papers, delivered, top_n=5)
        assert result == []
