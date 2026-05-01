"""Helper for upserting per-Lambda status into the pipeline-runs table.

Each Lambda calls ``upsert_run_status`` at the end of its handler so that the
monitoring dashboard can render run history. Failures here are swallowed —
losing a status row should never break the pipeline itself.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import boto3

logger = logging.getLogger(__name__)

# pipeline-runs records are kept for ~90 days for the dashboard window.
RETENTION_DAYS = 90

_RESERVED_WORDS = {
    "date",
    "status",
    "error",
    "name",
    "type",
    "value",
    "data",
    "size",
    "key",
    "ttl",
}


def _resource() -> Any:
    return boto3.resource("dynamodb")


def _to_attr(value: Any) -> Any:
    """Convert Python values into DynamoDB-friendly types.

    DynamoDB resource API rejects ``float``; coerce to ``Decimal``. Recurses
    into nested dicts/lists so we can store ``weights_snapshot`` etc.
    """

    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_attr(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_attr(v) for v in value]
    return value


def _placeholder(name: str) -> str:
    return name.replace(".", "_")


def upsert_run_status(
    date: str,
    lambda_name: str,
    status: str,
    error: str | None = None,
    table_name: str | None = None,
    **extra_attrs: Any,
) -> None:
    """Upsert this Lambda's status fields into the pipeline-runs row for ``date``.

    Args:
        date: JST date string (YYYY-MM-DD).
        lambda_name: Logical name (collector / scorer / deliverer / weight_adjuster
            / token_refresher / summarizer). Used as the field prefix.
        status: ``success`` / ``error`` / ``running`` / ``skipped``.
        error: Optional error message (truncated to 500 chars).
        table_name: Override for the table; defaults to env ``PIPELINE_RUNS_TABLE``.
        **extra_attrs: Additional top-level attributes to set on the row, e.g.
            ``papers_collected_hf=42``.
    """

    table_name = table_name or os.environ.get("PIPELINE_RUNS_TABLE")
    if not table_name:
        logger.warning("PIPELINE_RUNS_TABLE not configured; skipping upsert for %s", lambda_name)
        return

    now = datetime.now(UTC)
    ttl_epoch = int((now + timedelta(days=RETENTION_DAYS)).timestamp())

    fields: dict[str, Any] = {
        f"{lambda_name}_status": status,
        f"{lambda_name}_finished_at": now.isoformat(),
        "ttl": ttl_epoch,
    }
    error_attr = f"{lambda_name}_error"
    if error is not None:
        fields[error_attr] = (error or "")[:500]
    for k, v in extra_attrs.items():
        if v is None:
            continue
        fields[k] = _to_attr(v)

    set_clauses: list[str] = []
    expr_names: dict[str, str] = {}
    expr_values: dict[str, Any] = {}
    for idx, (name, value) in enumerate(fields.items()):
        placeholder = f":v{idx}"
        if name in _RESERVED_WORDS or "." in name:
            alias = f"#n{idx}"
            expr_names[alias] = name
            set_clauses.append(f"{alias} = {placeholder}")
        else:
            set_clauses.append(f"{name} = {placeholder}")
        expr_values[placeholder] = value

    # When this call has no error, drop any stale <stage>_error attribute from
    # a prior failed run on the same date so the dashboard doesn't show
    # status=success alongside an old error message.
    remove_clauses: list[str] = []
    if error is None:
        if error_attr in _RESERVED_WORDS or "." in error_attr:
            alias = f"#n{len(expr_names)}"
            expr_names[alias] = error_attr
            remove_clauses.append(alias)
        else:
            remove_clauses.append(error_attr)

    update_expression = "SET " + ", ".join(set_clauses)
    if remove_clauses:
        update_expression += " REMOVE " + ", ".join(remove_clauses)

    update_kwargs: dict[str, Any] = {
        "Key": {"date": date},
        "UpdateExpression": update_expression,
        "ExpressionAttributeValues": expr_values,
    }
    if expr_names:
        update_kwargs["ExpressionAttributeNames"] = expr_names

    try:
        _resource().Table(table_name).update_item(**update_kwargs)
    except Exception:  # noqa: BLE001 - never break the pipeline on telemetry failure
        logger.warning(
            "pipeline-runs upsert failed (date=%s, lambda=%s)", date, lambda_name, exc_info=True
        )
