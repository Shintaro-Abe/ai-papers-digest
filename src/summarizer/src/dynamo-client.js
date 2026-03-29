"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient);

const PAPERS_TABLE = process.env.PAPERS_TABLE;
const SUMMARIES_TABLE = process.env.SUMMARIES_TABLE;

/**
 * Fetch a paper record from the papers table.
 */
async function getPaper(arxivId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: PAPERS_TABLE,
      Key: { arxiv_id: arxivId },
    })
  );
  return result.Item || null;
}

/**
 * Store a summary record in the summaries table.
 */
async function putSummary(arxivId, summary, date) {
  const item = {
    arxiv_id: arxivId,
    summary_version: "v1",
    is_active: true,
    created_at: new Date().toISOString(),
    date,
    title_original: summary.title_original,
    title_ja: summary.title_ja,
    compact_summary: summary.compact_summary,
    detail_novelty: summary.detail?.novelty,
    detail_method: summary.detail?.method,
    detail_results: summary.detail?.results,
    detail_practicality: summary.detail?.practicality,
    tags: summary.tags || [],
  };

  await docClient.send(
    new PutCommand({
      TableName: SUMMARIES_TABLE,
      Item: item,
    })
  );

  return item;
}

/**
 * Retrieve all active summaries for a given date.
 * Uses a Scan with filter (acceptable for daily volumes).
 */
async function getSummariesByDate(date) {
  const items = [];
  let lastKey;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: SUMMARIES_TABLE,
        FilterExpression:
          "begins_with(created_at, :d) AND is_active = :active",
        ExpressionAttributeValues: {
          ":d": date,
          ":active": true,
        },
        ExclusiveStartKey: lastKey,
      })
    );

    if (result.Items) {
      items.push(...result.Items);
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

module.exports = { getPaper, putSummary, getSummariesByDate };
