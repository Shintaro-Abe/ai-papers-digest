"""Tests for scorer Lambda components."""

from src.lambdas.scorer.filter import filter_papers
from src.lambdas.scorer.scoring import calculate_scores, normalize


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
