"""Lambda handler for paper collection."""

import json
import logging
import os
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import boto3

import arxiv_client, hf_client, paper_merger, s2_client

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

JST = timezone(timedelta(hours=9))

dynamodb = boto3.resource("dynamodb")
lambda_client = boto3.client("lambda")


def _today_jst() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d")


def _save_papers(table_name: str, papers: list[dict[str, Any]]) -> int:
    """Save papers to DynamoDB. Returns count of saved items."""
    table = dynamodb.Table(table_name)
    saved = 0
    for paper in papers:
        try:
            item: dict[str, Any] = {
                "arxiv_id": paper["arxiv_id"],
                "title": paper.get("title", ""),
                "abstract": paper.get("abstract", ""),
                "authors": paper.get("authors", []),
                "categories": paper.get("categories", []),
                "published_date": paper.get("published_date", ""),
                "hf_upvotes": paper.get("hf_upvotes", 0),
                "hf_ai_summary": paper.get("hf_ai_summary", ""),
                "hf_ai_keywords": paper.get("hf_ai_keywords", []),
                "github_repo": paper.get("github_repo", ""),
                "s2_citation_count": paper.get("s2_citation_count", 0),
                "s2_tldr": paper.get("s2_tldr", ""),
                "source_count": paper.get("source_count", 1),
                "collected_date": _today_jst(),
                "collected_at": datetime.now(UTC).isoformat(),
            }
            # Remove empty strings for DynamoDB (optional fields)
            item = {k: v for k, v in item.items() if v != "" and v != []}
            # Ensure required fields are always present
            item["arxiv_id"] = paper["arxiv_id"]
            item["collected_date"] = _today_jst()

            table.put_item(Item=item)
            saved += 1
        except Exception:
            logger.exception("Failed to save paper %s", paper.get("arxiv_id"))

    return saved


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Collect papers from all sources and invoke scorer."""
    collection_date = event.get("date", _today_jst())
    logger.info("Starting paper collection for collection_date=%s", collection_date)

    papers_table = os.environ["PAPERS_TABLE"]
    scorer_function = os.environ["SCORER_FUNCTION_NAME"]
    s2_secret_arn = os.environ["S2_API_KEY_SECRET_ARN"]
    categories_str = os.environ.get("TARGET_CATEGORIES", "cs.AI,cs.CL,cs.CV,cs.LG,stat.ML")
    categories = [c.strip() for c in categories_str.split(",")]

    # 1. Fetch from Hugging Face (UTC dates — HF API is UTC-based)
    # When an explicit date is provided (backfill/retry), derive HF dates
    # from it; otherwise use the current UTC clock.
    if "date" in event:
        # Explicit date is JST; subtract 1 day to approximate UTC equivalent
        base = datetime.strptime(collection_date, "%Y-%m-%d")
        hf_date = (base - timedelta(days=1)).strftime("%Y-%m-%d")
        hf_prev = (base - timedelta(days=2)).strftime("%Y-%m-%d")
    else:
        utc_now = datetime.now(UTC)
        hf_date = utc_now.strftime("%Y-%m-%d")
        hf_prev = (utc_now - timedelta(days=1)).strftime("%Y-%m-%d")

    hf_today = hf_client.fetch_daily_papers(hf_date)
    hf_prev_papers = hf_client.fetch_daily_papers(hf_prev)
    seen_hf_ids = {p["arxiv_id"] for p in hf_today}
    hf_papers = hf_today + [p for p in hf_prev_papers if p["arxiv_id"] not in seen_hf_ids]
    hf_new = len(hf_papers) - len(hf_today)
    logger.info(
        "HF papers: %d (date=%s) + %d new (date=%s) = %d total",
        len(hf_today), hf_date, hf_new, hf_prev, len(hf_papers),
    )

    # 2. Fetch from arXiv
    arxiv_papers = arxiv_client.fetch_recent_papers(categories)

    # 3. Merge and deduplicate (arxiv_id dedup handles HF overlap)
    merged = paper_merger.merge(hf_papers, arxiv_papers)

    if not merged:
        logger.warning("No papers collected for collection_date=%s", collection_date)
        return {"statusCode": 200, "body": "No papers found"}

    # 4. Enrich with Semantic Scholar
    arxiv_ids = [p["arxiv_id"] for p in merged]
    s2_data = s2_client.fetch_batch(arxiv_ids, s2_secret_arn)
    enriched = paper_merger.enrich(merged, s2_data)

    # 5. Save to DynamoDB
    saved_count = _save_papers(papers_table, enriched)
    logger.info("Saved %d/%d papers to DynamoDB", saved_count, len(enriched))

    # 6. Invoke scorer asynchronously
    payload = {"date": collection_date}
    lambda_client.invoke(
        FunctionName=scorer_function,
        InvocationType="Event",
        Payload=json.dumps(payload),
    )
    logger.info("Invoked scorer for date=%s", collection_date)

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "date": collection_date,
                "hf_date": hf_date,
                "hf_prev_date": hf_prev,
                "hf_count": len(hf_papers),
                "arxiv_count": len(arxiv_papers),
                "merged_count": len(merged),
                "saved_count": saved_count,
            }
        ),
    }
