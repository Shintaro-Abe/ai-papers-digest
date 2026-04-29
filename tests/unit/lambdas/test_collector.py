"""Tests for collector Lambda components."""

import json
import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
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


class TestCollectorHandlerHfDates:
    """Tests for collector handler — HF date logic.

    handler.py uses absolute imports (import arxiv_client) that only resolve
    at Lambda runtime. We add the collector package to sys.path temporarily
    so the handler can be imported in the test environment.
    """

    @pytest.fixture(autouse=True)
    def _import_handler(self) -> Any:
        """Import handler with collector dir on sys.path, mocking boto3."""
        import importlib
        collector_dir = str(Path(__file__).resolve().parents[3] / "src" / "lambdas" / "collector")
        sys.path.insert(0, collector_dir)
        try:
            with patch("boto3.resource"), patch("boto3.client"):
                self.handler_mod = importlib.import_module("handler")
                importlib.reload(self.handler_mod)
            yield
        finally:
            sys.path.remove(collector_dir)

    @patch("handler.lambda_client")
    @patch("handler._save_papers", return_value=3)
    @patch("handler.s2_client")
    @patch("handler.arxiv_client")
    @patch("handler.hf_client")
    def test_hf_dates_are_utc_based(
        self,
        mock_hf: MagicMock,
        mock_arxiv: MagicMock,
        mock_s2: MagicMock,
        mock_save: MagicMock,
        mock_lambda: MagicMock,
    ) -> None:
        """HF API should be called with UTC dates, not JST."""
        mock_hf.fetch_daily_papers.return_value = []
        mock_arxiv.fetch_recent_papers.return_value = [
            {"arxiv_id": "001", "title": "Test", "source": "arxiv"},
        ]
        mock_s2.fetch_batch.return_value = {}

        # Simulate JST 06:00 = UTC 21:00 previous day
        fake_utc = datetime(2026, 4, 28, 21, 0, 0, tzinfo=UTC)
        with patch("handler.datetime") as mock_dt:
            mock_dt.now.side_effect = lambda tz=None: fake_utc if tz == UTC else fake_utc.astimezone(timezone(timedelta(hours=9)))
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

            self.handler_mod.handler({}, None)

        # HF should be called with UTC dates (04-28 and 04-27), NOT JST (04-29)
        hf_calls = mock_hf.fetch_daily_papers.call_args_list
        assert len(hf_calls) == 2
        hf_dates = {c.args[0] for c in hf_calls}
        assert "2026-04-28" in hf_dates  # UTC today
        assert "2026-04-27" in hf_dates  # UTC yesterday
        assert "2026-04-29" not in hf_dates  # JST date should NOT be used

    @patch("handler.lambda_client")
    @patch("handler._save_papers", return_value=2)
    @patch("handler.s2_client")
    @patch("handler.arxiv_client")
    @patch("handler.hf_client")
    def test_hf_dedup_across_dates(
        self,
        mock_hf: MagicMock,
        mock_arxiv: MagicMock,
        mock_s2: MagicMock,
        mock_save: MagicMock,
        mock_lambda: MagicMock,
    ) -> None:
        """Papers appearing in both HF dates should be deduped, keeping today's data."""
        paper_today = {"arxiv_id": "001", "title": "Paper", "hf_upvotes": 50, "source": "huggingface"}
        paper_yesterday_dup = {"arxiv_id": "001", "title": "Paper", "hf_upvotes": 30, "source": "huggingface"}
        paper_yesterday_only = {"arxiv_id": "002", "title": "Other", "hf_upvotes": 10, "source": "huggingface"}

        mock_hf.fetch_daily_papers.side_effect = [
            [paper_today],          # UTC today
            [paper_yesterday_dup, paper_yesterday_only],  # UTC yesterday
        ]
        mock_arxiv.fetch_recent_papers.return_value = []
        mock_s2.fetch_batch.return_value = {}

        with patch("handler.datetime") as mock_dt:
            fake_utc = datetime(2026, 4, 28, 21, 0, 0, tzinfo=UTC)
            mock_dt.now.side_effect = lambda tz=None: fake_utc if tz == UTC else fake_utc.astimezone(timezone(timedelta(hours=9)))
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

            result = self.handler_mod.handler({}, None)

        body = json.loads(result["body"])
        # 2 unique HF papers (001 deduped, 002 from yesterday)
        assert body["hf_count"] == 2

    @patch("handler.lambda_client")
    @patch("handler._save_papers", return_value=1)
    @patch("handler.s2_client")
    @patch("handler.arxiv_client")
    @patch("handler.hf_client")
    def test_explicit_date_derives_hf_dates_from_collection_date(
        self,
        mock_hf: MagicMock,
        mock_arxiv: MagicMock,
        mock_s2: MagicMock,
        mock_save: MagicMock,
        mock_lambda: MagicMock,
    ) -> None:
        """When event has explicit date (backfill), HF dates derive from it."""
        mock_hf.fetch_daily_papers.return_value = []
        mock_arxiv.fetch_recent_papers.return_value = [
            {"arxiv_id": "001", "title": "Test", "source": "arxiv"},
        ]
        mock_s2.fetch_batch.return_value = {}

        # Backfill for JST 2026-04-20 → HF should query 04-19 and 04-18
        self.handler_mod.handler({"date": "2026-04-20"}, None)

        hf_calls = mock_hf.fetch_daily_papers.call_args_list
        assert len(hf_calls) == 2
        hf_dates = {c.args[0] for c in hf_calls}
        assert "2026-04-19" in hf_dates  # JST-1 day
        assert "2026-04-18" in hf_dates  # JST-2 days
