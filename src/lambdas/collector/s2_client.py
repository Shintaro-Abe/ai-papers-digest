"""Semantic Scholar API client."""

import json
import logging
from typing import Any

import boto3
import requests

logger = logging.getLogger(__name__)

S2_API_BASE = "https://api.semanticscholar.org/graph/v1"
S2_BATCH_FIELDS = "citationCount,tldr,externalIds"


def _get_api_key(secret_arn: str) -> str:
    """Retrieve Semantic Scholar API key from Secrets Manager."""
    client = boto3.client("secretsmanager")
    resp = client.get_secret_value(SecretId=secret_arn)
    return resp["SecretString"]


def fetch_batch(arxiv_ids: list[str], secret_arn: str) -> dict[str, dict[str, Any]]:
    """Fetch paper metadata from Semantic Scholar batch API.

    Args:
        arxiv_ids: List of arXiv IDs.
        secret_arn: Secrets Manager ARN for S2 API key.

    Returns:
        Dict mapping arxiv_id to S2 metadata (citation_count, tldr).
    """
    if not arxiv_ids:
        return {}

    api_key = _get_api_key(secret_arn)
    url = f"{S2_API_BASE}/paper/batch"
    headers = {"x-api-key": api_key, "Content-Type": "application/json"}

    s2_ids = [f"ArXiv:{aid}" for aid in arxiv_ids]
    payload = {"ids": s2_ids}

    try:
        resp = requests.post(
            url,
            headers=headers,
            params={"fields": S2_BATCH_FIELDS},
            data=json.dumps(payload),
            timeout=30,
        )
        resp.raise_for_status()
        results = resp.json()
    except Exception:
        logger.exception("Failed to fetch S2 batch data for %d papers", len(arxiv_ids))
        return {}

    enrichment: dict[str, dict[str, Any]] = {}
    for item in results:
        if item is None:
            continue
        external_ids = item.get("externalIds", {})
        arxiv_id = external_ids.get("ArXiv", "")
        if not arxiv_id:
            continue

        tldr_obj = item.get("tldr")
        enrichment[arxiv_id] = {
            "s2_citation_count": item.get("citationCount", 0),
            "s2_tldr": tldr_obj.get("text", "") if tldr_obj else "",
        }

    logger.info("Enriched %d/%d papers from Semantic Scholar", len(enrichment), len(arxiv_ids))
    return enrichment
