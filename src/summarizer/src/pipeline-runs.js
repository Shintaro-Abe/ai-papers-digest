'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const RETENTION_DAYS = 90;

const RESERVED_WORDS = new Set([
  'date',
  'status',
  'error',
  'name',
  'type',
  'value',
  'data',
  'size',
  'key',
  'ttl',
]);

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient);

/**
 * Upsert this stage's status into the pipeline-runs row for ``date``.
 *
 * Mirrors the Python helper in src/shared/pipeline_runs.py — both write to the
 * same DynamoDB table keyed on ``date``, with attribute names prefixed by
 * ``lambda_name`` so multiple stages can share one row.
 *
 * Failures are swallowed: monitoring writes must never break the pipeline.
 */
async function upsertRunStatus(
  date,
  lambdaName,
  status,
  { error = null, tableName = process.env.PIPELINE_RUNS_TABLE, extra = {} } = {}
) {
  if (!tableName) {
    console.warn(`[pipeline-runs] PIPELINE_RUNS_TABLE not configured; skipping ${lambdaName}`);
    return;
  }

  const now = new Date();
  const ttlEpoch = Math.floor((now.getTime() + RETENTION_DAYS * 86_400_000) / 1000);

  const fields = {
    [`${lambdaName}_status`]: status,
    [`${lambdaName}_finished_at`]: now.toISOString(),
    ttl: ttlEpoch,
  };
  const errorAttr = `${lambdaName}_error`;
  const hasError = error !== null && error !== undefined;
  if (hasError) {
    fields[errorAttr] = String(error).slice(0, 500);
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === null || v === undefined) continue;
    fields[k] = v;
  }

  const setClauses = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};
  let idx = 0;
  for (const [name, value] of Object.entries(fields)) {
    const placeholder = `:v${idx}`;
    if (RESERVED_WORDS.has(name) || name.includes('.')) {
      const alias = `#n${idx}`;
      expressionAttributeNames[alias] = name;
      setClauses.push(`${alias} = ${placeholder}`);
    } else {
      setClauses.push(`${name} = ${placeholder}`);
    }
    expressionAttributeValues[placeholder] = value;
    idx += 1;
  }

  // When this call has no error, drop any stale <stage>_error attribute from
  // a prior failed run on the same date so the dashboard doesn't show
  // status=success alongside an old error message.
  const removeClauses = [];
  if (!hasError) {
    if (RESERVED_WORDS.has(errorAttr) || errorAttr.includes('.')) {
      const alias = `#n${idx}`;
      expressionAttributeNames[alias] = errorAttr;
      removeClauses.push(alias);
      idx += 1;
    } else {
      removeClauses.push(errorAttr);
    }
  }

  let updateExpression = `SET ${setClauses.join(', ')}`;
  if (removeClauses.length > 0) {
    updateExpression += ` REMOVE ${removeClauses.join(', ')}`;
  }

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { date },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ...(Object.keys(expressionAttributeNames).length
      ? { ExpressionAttributeNames: expressionAttributeNames }
      : {}),
  });

  try {
    await docClient.send(command);
  } catch (err) {
    console.warn(
      `[pipeline-runs] upsert failed (date=${date}, lambda=${lambdaName}): ${err.message}`
    );
  }
}

module.exports = { upsertRunStatus };
