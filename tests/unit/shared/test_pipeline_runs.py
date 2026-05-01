"""Unit tests for the shared pipeline_runs helper."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

SHARED_DIR = Path(__file__).resolve().parents[3] / "src" / "shared"


@pytest.fixture(autouse=True)
def _import_helper(monkeypatch: pytest.MonkeyPatch) -> None:
    """Import the helper as a top-level module the way Lambda packaging will.

    deploy.yml flattens src/shared/*.py into each Lambda zip alongside
    handler.py, so the import statement in production code is
    ``from pipeline_runs import upsert_run_status``. Replicate that here.
    """

    sys.path.insert(0, str(SHARED_DIR))


@pytest.fixture()
def runs_table() -> str:
    table_name = "test-pipeline-runs"
    with mock_aws():
        client = boto3.client("dynamodb", region_name="ap-northeast-1")
        client.create_table(
            TableName=table_name,
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": "date", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "date", "KeyType": "HASH"}],
        )
        yield table_name


def test_upsert_writes_status_and_extra_attrs(
    runs_table: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PIPELINE_RUNS_TABLE", runs_table)
    import pipeline_runs

    pipeline_runs.upsert_run_status(
        date="2026-04-30",
        lambda_name="collector",
        status="success",
        papers_collected_hf=12,
        papers_collected_arxiv=45,
    )

    item = boto3.resource("dynamodb", region_name="ap-northeast-1").Table(runs_table).get_item(
        Key={"date": "2026-04-30"}
    )["Item"]
    assert item["collector_status"] == "success"
    assert item["papers_collected_hf"] == 12
    assert item["papers_collected_arxiv"] == 45
    assert "collector_finished_at" in item
    assert "ttl" in item


def test_upsert_records_error_truncated(
    runs_table: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PIPELINE_RUNS_TABLE", runs_table)
    import pipeline_runs

    long_msg = "x" * 1000
    pipeline_runs.upsert_run_status(
        date="2026-04-30",
        lambda_name="scorer",
        status="error",
        error=long_msg,
    )

    item = boto3.resource("dynamodb", region_name="ap-northeast-1").Table(runs_table).get_item(
        Key={"date": "2026-04-30"}
    )["Item"]
    assert item["scorer_status"] == "error"
    assert len(item["scorer_error"]) == 500


def test_upsert_merges_multiple_lambdas_into_same_row(
    runs_table: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PIPELINE_RUNS_TABLE", runs_table)
    import pipeline_runs

    pipeline_runs.upsert_run_status("2026-04-30", "collector", "success", papers_collected_hf=5)
    pipeline_runs.upsert_run_status("2026-04-30", "scorer", "success", papers_selected=3)

    item = boto3.resource("dynamodb", region_name="ap-northeast-1").Table(runs_table).get_item(
        Key={"date": "2026-04-30"}
    )["Item"]
    assert item["collector_status"] == "success"
    assert item["scorer_status"] == "success"
    assert item["papers_collected_hf"] == 5
    assert item["papers_selected"] == 3


def test_upsert_converts_floats_to_decimal(
    runs_table: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PIPELINE_RUNS_TABLE", runs_table)
    import pipeline_runs

    pipeline_runs.upsert_run_status(
        date="2026-04-30",
        lambda_name="scorer",
        status="success",
        weights_snapshot={"w1": 0.4, "w2": 0.21, "w3": 0.19, "w4": 0.2},
        claude_cost_usd=1.234,
    )

    item = boto3.resource("dynamodb", region_name="ap-northeast-1").Table(runs_table).get_item(
        Key={"date": "2026-04-30"}
    )["Item"]
    assert item["weights_snapshot"]["w1"] == Decimal("0.4")
    assert item["claude_cost_usd"] == Decimal("1.234")


def test_upsert_swallows_table_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Failure to upsert must not raise — pipeline must keep running."""

    monkeypatch.setenv("PIPELINE_RUNS_TABLE", "nonexistent-table")
    import pipeline_runs

    with mock_aws():
        # No table created — update_item should raise ResourceNotFoundException
        # but the helper must swallow it.
        pipeline_runs.upsert_run_status("2026-04-30", "collector", "success")


def test_upsert_skips_when_env_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PIPELINE_RUNS_TABLE", raising=False)
    import pipeline_runs

    pipeline_runs.upsert_run_status("2026-04-30", "collector", "success")


def test_successful_retry_clears_prior_stage_error(
    runs_table: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Codex review fix: a successful retry on the same date must drop the
    prior failure's <stage>_error attribute so the dashboard never shows
    status=success alongside a stale error string."""

    monkeypatch.setenv("PIPELINE_RUNS_TABLE", runs_table)
    import pipeline_runs

    # First run: collector fails, error attribute is recorded
    pipeline_runs.upsert_run_status(
        "2026-04-30", "collector", "error", error="boom (transient)"
    )
    item = boto3.resource("dynamodb", region_name="ap-northeast-1").Table(runs_table).get_item(
        Key={"date": "2026-04-30"}
    )["Item"]
    assert item["collector_status"] == "error"
    assert item["collector_error"].startswith("boom")

    # Retry: same date, success — collector_error must be cleared
    pipeline_runs.upsert_run_status(
        "2026-04-30", "collector", "success", papers_collected_hf=10
    )
    item = boto3.resource("dynamodb", region_name="ap-northeast-1").Table(runs_table).get_item(
        Key={"date": "2026-04-30"}
    )["Item"]
    assert item["collector_status"] == "success"
    assert "collector_error" not in item, "stale error must be cleared on success"
    assert item["papers_collected_hf"] == 10


def test_other_stage_errors_are_preserved_on_independent_success(
    runs_table: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Each stage's error is keyed by lambda_name; clearing one stage's error
    on its own success must NOT touch another stage's error."""

    monkeypatch.setenv("PIPELINE_RUNS_TABLE", runs_table)
    import pipeline_runs

    pipeline_runs.upsert_run_status("2026-04-30", "scorer", "error", error="oops")
    pipeline_runs.upsert_run_status("2026-04-30", "collector", "success")

    item = boto3.resource("dynamodb", region_name="ap-northeast-1").Table(runs_table).get_item(
        Key={"date": "2026-04-30"}
    )["Item"]
    assert item["collector_status"] == "success"
    assert "collector_error" not in item
    # scorer's error is preserved — it hasn't been retried yet
    assert item["scorer_status"] == "error"
    assert item["scorer_error"] == "oops"
