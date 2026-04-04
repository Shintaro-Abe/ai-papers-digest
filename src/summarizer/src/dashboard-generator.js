'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { upload } = require('./s3-uploader');
const { escapeHtml } = require('./html-generator');

const TEMPLATES_DIR = path.resolve(__dirname, '../templates');
const SUMMARIES_TABLE = process.env.SUMMARIES_TABLE;

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient);

/**
 * Fetch all active summaries from DynamoDB.
 */
async function getAllSummaries() {
  const items = [];
  let lastKey;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: SUMMARIES_TABLE,
        FilterExpression: 'is_active = :active',
        ExpressionAttributeValues: { ':active': true },
        ExclusiveStartKey: lastKey,
      })
    );
    if (result.Items) items.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/**
 * Build tag aggregation from summaries.
 * Returns Map<tag, summary[]> sorted by tag name.
 */
function aggregateTags(summaries) {
  const tagMap = new Map();
  for (const s of summaries) {
    const tags = Array.isArray(s.tags) ? s.tags : [];
    for (const tag of tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag).push(s);
    }
  }
  return new Map([...tagMap.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/**
 * Render tag list page.
 */
function renderTagList(tagMap) {
  const template = fs.readFileSync(path.join(TEMPLATES_DIR, 'tag-list.html'), 'utf-8');
  const tagItems = [...tagMap.entries()]
    .map(([tag, papers]) => {
      return `        <a href="/tags/${escapeHtml(encodeURIComponent(tag))}.html" class="tag-link-card">
          <span class="tag-name">${escapeHtml(tag)}</span>
          <span class="tag-count">${papers.length} 件</span>
        </a>`;
    })
    .join('\n');

  return template
    .replace(/\{\{tag_count\}\}/g, String(tagMap.size))
    .replace(/\{\{tag_items\}\}/g, tagItems);
}

/**
 * Render a single tag page.
 */
function renderTagPage(tag, summaries) {
  const template = fs.readFileSync(path.join(TEMPLATES_DIR, 'tag-page.html'), 'utf-8');
  const sorted = [...summaries].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const paperCards = sorted
    .map((s) => {
      const tags = Array.isArray(s.tags) ? s.tags : [];
      const tagsHtml = tags
        .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
        .join('\n              ');
      return `        <article class="card">
          <h2 class="card-title">
            <a href="/papers/${escapeHtml(s.arxiv_id)}.html">${escapeHtml(s.title_ja)}</a>
          </h2>
          <p class="card-original-title">${escapeHtml(s.title_original)}</p>
          <p class="card-summary">${escapeHtml(s.compact_summary)}</p>
          <div class="card-meta">
            <span class="card-date">${escapeHtml(s.date || '')}</span>
          </div>
          <div class="tags">
            ${tagsHtml}
          </div>
        </article>`;
    })
    .join('\n');

  return template
    .replace(/\{\{tag\}\}/g, escapeHtml(tag))
    .replace(/\{\{paper_count\}\}/g, String(summaries.length))
    .replace(/\{\{paper_cards\}\}/g, paperCards);
}

/**
 * Render search page.
 */
function renderSearchPage() {
  return fs.readFileSync(path.join(TEMPLATES_DIR, 'search.html'), 'utf-8');
}

/**
 * Build search index JSON for lunr.js.
 */
function buildSearchIndex(summaries) {
  const papers = summaries.map((s) => ({
    id: s.arxiv_id,
    title: s.title_original || '',
    title_ja: s.title_ja || '',
    compact_summary: s.compact_summary || '',
    tags: Array.isArray(s.tags) ? s.tags.join(' ') : '',
    date: s.date || '',
    url: `/papers/${s.arxiv_id}.html`,
  }));
  return JSON.stringify({ version: 1, papers });
}

/**
 * Render index.html that redirects to latest digest.
 */
function renderIndex(latestDate) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0;url=/digest/${escapeHtml(latestDate)}.html">
  <title>AI Papers Digest</title>
</head>
<body>
  <p>Redirecting to <a href="/digest/${escapeHtml(latestDate)}.html">latest digest</a>...</p>
</body>
</html>`;
}

/**
 * Main dashboard generation entry point.
 */
async function generate(currentDate) {
  console.log('[dashboard] Fetching all summaries...');
  const allSummaries = await getAllSummaries();
  console.log(`[dashboard] Found ${allSummaries.length} total summaries`);

  if (allSummaries.length === 0) {
    console.log('[dashboard] No summaries found, skipping dashboard generation');
    return;
  }

  // 1. Tag pages
  const tagMap = aggregateTags(allSummaries);
  console.log(`[dashboard] Generating ${tagMap.size} tag pages...`);

  const tagListHtml = renderTagList(tagMap);
  await upload('tags/index.html', tagListHtml);

  for (const [tag, papers] of tagMap) {
    const tagPageHtml = renderTagPage(tag, papers);
    await upload(`tags/${encodeURIComponent(tag)}.html`, tagPageHtml);
  }

  // 2. Search index + page
  console.log('[dashboard] Generating search index and page...');
  const searchIndex = buildSearchIndex(allSummaries);
  await upload('search-index.json', searchIndex);

  const searchPageHtml = renderSearchPage();
  await upload('search.html', searchPageHtml);

  // 3. Index page (redirect to latest digest)
  const dates = [...new Set(allSummaries.map((s) => s.date).filter(Boolean))].sort();
  const latestDate = dates.length > 0 ? dates[dates.length - 1] : currentDate;
  const indexHtml = renderIndex(latestDate);
  await upload('index.html', indexHtml);

  console.log(`[dashboard] Dashboard generation complete. Tags: ${tagMap.size}, Papers: ${allSummaries.length}`);
}

module.exports = { generate };
