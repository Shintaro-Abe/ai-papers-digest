"""Tests for collector Lambda components."""

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.lambdas.collector import arxiv_client, hf_client, paper_merger, s2_client


class TestHfClient:
    """Tests for hf_client module."""

    @patch("src.lambdas.collector.hf_client.requests.get")
    def test_fetch_daily_papers_success(self, mock_get: MagicMock, hf_daily_papers_response: list[dict]) -> None:
        mock_resp = MagicMock()
        mock_resp.json.return_value = hf_daily_papers_response
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        papers = hf_client.fetch_daily_papers("2026-03-26")

        assert len(papers) == 2
        assert papers[0]["arxiv_id"] == "2603.18718"
        assert papers[0]["hf_upvotes"] == 42
        assert papers[0]["source"] == "huggingface"
        assert papers[1]["arxiv_id"] == "2603.17542"
        assert papers[1]["hf_upvotes"] == 85

    @patch("src.lambdas.collector.hf_client.requests.get")
    def test_fetch_daily_papers_api_error(self, mock_get: MagicMock) -> None:
        mock_get.side_effect = Exception("Connection error")
        papers = hf_client.fetch_daily_papers("2026-03-26")
        assert papers == []


class TestArxivClient:
    """Tests for arxiv_client module."""

    def test_extract_arxiv_id_with_version(self) -> None:
        assert arxiv_client.extract_arxiv_id("http://arxiv.org/abs/2603.18718v1") == "2603.18718"

    def test_extract_arxiv_id_without_version(self) -> None:
        assert arxiv_client.extract_arxiv_id("http://arxiv.org/abs/2603.18718") == "2603.18718"

    def test_extract_arxiv_id_five_digit(self) -> None:
        assert arxiv_client.extract_arxiv_id("http://arxiv.org/abs/2603.12345v2") == "2603.12345"


class TestS2Client:
    """Tests for s2_client module."""

    @patch("src.lambdas.collector.s2_client.requests.post")
    @patch("src.lambdas.collector.s2_client._get_api_key")
    def test_fetch_batch_success(
        self, mock_key: MagicMock, mock_post: MagicMock, s2_batch_response: list[dict]
    ) -> None:
        mock_key.return_value = "test-key"
        mock_resp = MagicMock()
        mock_resp.json.return_value = s2_batch_response
        mock_resp.raise_for_status.return_value = None
        mock_post.return_value = mock_resp

        result = s2_client.fetch_batch(["2603.18718", "2603.17542"], "arn:test")

        assert "2603.18718" in result
        assert result["2603.18718"]["s2_citation_count"] == 15
        assert "power-law" in result["2603.18718"]["s2_tldr"]
        assert "2603.17542" in result

    @patch("src.lambdas.collector.s2_client.requests.post")
    @patch("src.lambdas.collector.s2_client._get_api_key")
    def test_fetch_batch_api_error(self, mock_key: MagicMock, mock_post: MagicMock) -> None:
        mock_key.return_value = "test-key"
        mock_post.side_effect = Exception("API error")
        result = s2_client.fetch_batch(["2603.18718"], "arn:test")
        assert result == {}

    def test_fetch_batch_empty_ids(self) -> None:
        result = s2_client.fetch_batch([], "arn:test")
        assert result == {}


class TestPaperMerger:
    """Tests for paper_merger module."""

    def test_merge_deduplication(self) -> None:
        hf = [
            {"arxiv_id": "001", "title": "Paper A", "hf_upvotes": 10, "source": "huggingface"},
            {"arxiv_id": "002", "title": "Paper B", "hf_upvotes": 20, "source": "huggingface"},
        ]
        arxiv = [
            {"arxiv_id": "002", "title": "Paper B", "categories": ["cs.AI"], "authors": ["Alice"], "source": "arxiv"},
            {"arxiv_id": "003", "title": "Paper C", "categories": ["cs.CL"], "authors": ["Bob"], "source": "arxiv"},
        ]

        merged = paper_merger.merge(hf, arxiv)

        assert len(merged) == 3
        ids = {p["arxiv_id"] for p in merged}
        assert ids == {"001", "002", "003"}

        paper_002 = next(p for p in merged if p["arxiv_id"] == "002")
        assert paper_002["source_count"] == 2
        assert paper_002["hf_upvotes"] == 20  # HF data preserved

        paper_003 = next(p for p in merged if p["arxiv_id"] == "003")
        assert paper_003["hf_upvotes"] == 0  # Default for arXiv-only

    def test_enrich_with_s2_data(self) -> None:
        papers = [
            {"arxiv_id": "001", "source_count": 1, "sources": ["arxiv"]},
            {"arxiv_id": "002", "source_count": 2, "sources": ["arxiv", "huggingface"]},
        ]
        s2_data = {
            "001": {"s2_citation_count": 50, "s2_tldr": "Great paper."},
        }

        enriched = paper_merger.enrich(papers, s2_data)

        assert enriched[0]["s2_citation_count"] == 50
        assert enriched[0]["source_count"] == 2
        assert enriched[1]["s2_citation_count"] == 0  # Not in S2 data
