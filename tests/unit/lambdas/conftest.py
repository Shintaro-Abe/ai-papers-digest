"""Shared test fixtures for Lambda tests."""

import json
import os
import sys
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent.parent.parent / "fixtures"
SHARED_DIR = Path(__file__).resolve().parents[3] / "src" / "shared"

# Lambda packaging copies shared/*.py flat into each function's zip, so
# handlers do `from pipeline_runs import ...`. Make that import resolve in
# the test environment by exposing src/shared on sys.path once at collection.
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))


@pytest.fixture(autouse=True)
def _set_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set required environment variables for all tests."""
    monkeypatch.setenv("PAPERS_TABLE", "test-papers")
    monkeypatch.setenv("PAPER_SOURCES_TABLE", "test-paper-sources")
    monkeypatch.setenv("SUMMARIES_TABLE", "test-summaries")
    monkeypatch.setenv("DELIVERY_LOG_TABLE", "test-delivery-log")
    monkeypatch.setenv("CONFIG_TABLE", "test-config")
    monkeypatch.setenv("SCORER_FUNCTION_NAME", "test-scorer")
    monkeypatch.setenv("S2_API_KEY_SECRET_ARN", "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:test")
    monkeypatch.setenv("SLACK_WEBHOOK_SECRET_ARN", "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:test")
    monkeypatch.setenv("DETAIL_PAGE_BASE_URL", "https://test.cloudfront.net")
    monkeypatch.setenv("TARGET_CATEGORIES", "cs.AI,cs.CL")
    monkeypatch.setenv("ECS_CLUSTER", "test-cluster")
    monkeypatch.setenv("ECS_TASK_DEFINITION", "test-task-def")
    monkeypatch.setenv("ECS_SUBNETS", "subnet-1,subnet-2")
    monkeypatch.setenv("ECS_SECURITY_GROUP", "sg-123")
    monkeypatch.setenv("TOP_N", "3")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    monkeypatch.setenv("PIPELINE_RUNS_TABLE", "test-pipeline-runs")
    # Pinned so any helper that creates a boto3 client (e.g. pipeline_runs)
    # resolves an endpoint even in CI where AWS_DEFAULT_REGION is unset.
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-1")


@pytest.fixture()
def hf_daily_papers_response() -> list[dict]:
    """Load HF daily papers fixture."""
    return json.loads((FIXTURES_DIR / "hf_daily_papers.json").read_text())


@pytest.fixture()
def s2_batch_response() -> list[dict]:
    """Load S2 batch response fixture."""
    return json.loads((FIXTURES_DIR / "s2_batch_response.json").read_text())
