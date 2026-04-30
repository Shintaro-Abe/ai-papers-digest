'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchGetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { upload } = require('./s3-uploader');
const { escapeHtml, renderDetail, renderDigest } = require('./html-generator');

const TEMPLATES_DIR = path.resolve(__dirname, '../templates');
const SUMMARIES_TABLE = process.env.SUMMARIES_TABLE;
const PAPERS_TABLE = process.env.PAPERS_TABLE;

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
    await upload(`tags/${tag}.html`, tagPageHtml);
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

/**
 * Fetch papers from the papers table for the given arxiv_ids in batches of 100.
 * Returns a Map<arxiv_id, paper>.
 */
async function batchGetPapers(arxivIds) {
  const papers = new Map();
  if (!PAPERS_TABLE || arxivIds.length === 0) return papers;

  for (let i = 0; i < arxivIds.length; i += 100) {
    const chunk = arxivIds.slice(i, i + 100);
    const resp = await docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [PAPERS_TABLE]: { Keys: chunk.map((aid) => ({ arxiv_id: aid })) },
        },
      }),
    );
    const items = (resp.Responses && resp.Responses[PAPERS_TABLE]) || [];
    for (const p of items) papers.set(p.arxiv_id, p);
  }
  return papers;
}

/**
 * Run a list of async tasks with bounded concurrency.
 */
async function runWithConcurrency(items, limit, worker) {
  const queue = items.slice();
  let active = 0;
  let resolveAll;
  let rejectAll;
  const done = new Promise((resolve, reject) => {
    resolveAll = resolve;
    rejectAll = reject;
  });

  function next() {
    if (queue.length === 0 && active === 0) {
      resolveAll();
      return;
    }
    while (active < limit && queue.length > 0) {
      const item = queue.shift();
      active += 1;
      Promise.resolve(worker(item))
        .catch((err) => {
          console.warn(`[regenerate] task error: ${err.message}`);
        })
        .finally(() => {
          active -= 1;
          next();
        });
    }
  }
  next();
  return done;
}

/**
 * Re-render every existing paper detail page and digest page using the
 * latest templates. Idempotent: overwrites in place. Used to propagate
 * template changes (e.g., nav updates) to historical pages without
 * re-invoking the LLM.
 */
async function regenerateAllPapersAndDigests() {
  if (!PAPERS_TABLE) {
    console.warn('[regenerate] PAPERS_TABLE not set; skipping.');
    return;
  }

  const allSummaries = await getAllSummaries();
  if (allSummaries.length === 0) return;

  // 1. Resolve papers in batches
  const arxivIds = allSummaries.map((s) => s.arxiv_id).filter(Boolean);
  const paperMap = await batchGetPapers(arxivIds);
  console.log(
    `[regenerate] Resolved ${paperMap.size}/${arxivIds.length} papers from DynamoDB`,
  );

  // 2. Re-render every paper detail page
  let detailCount = 0;
  await runWithConcurrency(allSummaries, 8, async (summary) => {
    const paper = paperMap.get(summary.arxiv_id);
    if (!paper) return; // paper deleted/unavailable
    const html = renderDetail(paper, summary);
    await upload(`papers/${summary.arxiv_id}.html`, html);
    detailCount += 1;
  });
  console.log(`[regenerate] Re-uploaded ${detailCount} paper detail pages`);

  // 3. Group summaries by date and re-render each digest
  const byDate = new Map();
  for (const s of allSummaries) {
    if (!s.date) continue;
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  let digestCount = 0;
  await runWithConcurrency([...byDate.entries()], 4, async ([date, summaries]) => {
    const html = renderDigest(date, summaries);
    await upload(`digest/${date}.html`, html);
    digestCount += 1;
  });
  console.log(`[regenerate] Re-uploaded ${digestCount} daily digest pages`);
}

module.exports = {
  generate,
  regenerateAllPapersAndDigests,
  aggregateTags,
  renderTagList,
  renderTagPage,
  renderSearchPage,
  buildSearchIndex,
  renderIndex,
};
