'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  BatchGetCommand,
  GetCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');
const { upload } = require('./s3-uploader');
const { escapeHtml, renderDetail, renderDigest } = require('./html-generator');

const TEMPLATES_DIR = path.resolve(__dirname, '../templates');
const SUMMARIES_TABLE = process.env.SUMMARIES_TABLE;
const PAPERS_TABLE = process.env.PAPERS_TABLE;
const PIPELINE_RUNS_TABLE = process.env.PIPELINE_RUNS_TABLE;
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE;
const CONFIG_TABLE = process.env.CONFIG_TABLE;

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

// ---------------------------------------------------------------------------
// Monitoring dashboard
// ---------------------------------------------------------------------------

const DASHBOARD_WINDOW_DAYS = 30;
const DASHBOARD_SUMMARY_DAYS = 7;
const DASHBOARD_HEALTH_DAYS = 14;

/**
 * Format a Date instance as a YYYY-MM-DD string in UTC.
 */
function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Generate an array of YYYY-MM-DD strings ending at endDate (inclusive)
 * spanning ``days`` calendar days.
 */
function dateRange(endDate, days) {
  const end = endDate instanceof Date ? endDate : new Date(`${endDate}T00:00:00Z`);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime());
    d.setUTCDate(d.getUTCDate() - i);
    out.push(formatDate(d));
  }
  return out;
}

/**
 * Convert DynamoDB Number wrappers to plain JS numbers.
 */
function num(value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * Scan an entire DynamoDB table.
 */
async function scanAll(tableName, extraParams = {}) {
  const items = [];
  let lastKey;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
        ...extraParams,
      })
    );
    if (result.Items) items.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/**
 * Fetch every pipeline-runs row whose ``date`` is within the trailing window.
 */
async function fetchPipelineRunsLast30Days(targetDate) {
  if (!PIPELINE_RUNS_TABLE) return [];
  const cutoff = dateRange(targetDate, DASHBOARD_WINDOW_DAYS)[0];
  const items = await scanAll(PIPELINE_RUNS_TABLE, {
    FilterExpression: '#d >= :cutoff',
    ExpressionAttributeNames: { '#d': 'date' },
    ExpressionAttributeValues: { ':cutoff': cutoff },
  });
  items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return items;
}

/**
 * Fetch summaries whose date is within the trailing window.
 */
async function fetchSummariesLast30Days(targetDate) {
  if (!SUMMARIES_TABLE) return [];
  const cutoff = dateRange(targetDate, DASHBOARD_WINDOW_DAYS)[0];
  return scanAll(SUMMARIES_TABLE, {
    FilterExpression: '#d >= :cutoff AND is_active = :active',
    ExpressionAttributeNames: { '#d': 'date' },
    ExpressionAttributeValues: { ':cutoff': cutoff, ':active': true },
  });
}

/**
 * Fetch papers referenced by the recent summaries.
 */
async function fetchPapersForSummaries(summaries) {
  const ids = [...new Set(summaries.map((s) => s.arxiv_id).filter(Boolean))];
  return batchGetPapers(ids);
}

/**
 * Fetch feedback rows whose created_at is within the trailing window.
 */
async function fetchFeedbackLast30Days(targetDate) {
  if (!FEEDBACK_TABLE) return [];
  const cutoff = dateRange(targetDate, DASHBOARD_WINDOW_DAYS)[0];
  return scanAll(FEEDBACK_TABLE, {
    FilterExpression: 'created_at >= :cutoff',
    ExpressionAttributeValues: { ':cutoff': cutoff },
  });
}

/**
 * Fetch the scoring weights history kept in the config table.
 */
async function fetchWeightHistory() {
  if (!CONFIG_TABLE) return [];
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: CONFIG_TABLE,
        Key: { key: 'scoring_weights_history' },
      })
    );
    const raw = result.Item && result.Item.value;
    if (!raw) return [];
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`[dashboard] fetchWeightHistory failed: ${err.message}`);
    return [];
  }
}

/**
 * Index pipeline-runs by date so chart aggregations can do O(1) lookups.
 */
function indexByDate(items) {
  const map = new Map();
  for (const it of items) {
    if (it && it.date) map.set(it.date, it);
  }
  return map;
}

/**
 * Compute the four summary cards for the dashboard header.
 */
function computeSummaryCards(pipelineRuns, targetDate) {
  const window = dateRange(targetDate, DASHBOARD_SUMMARY_DAYS);
  const byDate = indexByDate(pipelineRuns);
  let collected = 0;
  let selected = 0;
  let delivered = 0;
  let costUsd = 0;
  for (const d of window) {
    const row = byDate.get(d);
    if (!row) continue;
    collected += num(row.papers_collected_total) || (num(row.papers_collected_hf) + num(row.papers_collected_arxiv));
    selected += num(row.papers_selected);
    delivered += num(row.papers_delivered);
    costUsd += num(row.claude_cost_usd);
  }
  return {
    collectedTotal7d: collected,
    selectedTotal7d: selected,
    deliveredTotal7d: delivered,
    claudeCost7dUsd: Number(costUsd.toFixed(4)),
  };
}

/**
 * Build the labels/HF/arXiv arrays for the collection volume chart.
 */
function aggregateCollectionVolume(pipelineRuns, targetDate) {
  const labels = dateRange(targetDate, DASHBOARD_WINDOW_DAYS);
  const byDate = indexByDate(pipelineRuns);
  return {
    labels,
    hf: labels.map((d) => num(byDate.get(d) && byDate.get(d).papers_collected_hf)),
    arxiv: labels.map((d) => num(byDate.get(d) && byDate.get(d).papers_collected_arxiv)),
  };
}

/**
 * Build payload for the latest selected-paper score chart.
 * The latest day with at least one selected paper is used.
 */
function aggregateLatestScores(summaries, papersById, pipelineRuns) {
  if (!summaries || summaries.length === 0) return { papers: [], weights: {} };
  const dates = [...new Set(summaries.map((s) => s.date).filter(Boolean))].sort();
  const latestDate = dates[dates.length - 1];
  const sameDay = summaries.filter((s) => s.date === latestDate);
  const enriched = sameDay
    .map((s) => {
      const paper = papersById.get(s.arxiv_id) || {};
      return {
        arxivId: s.arxiv_id,
        titleJa: s.title_ja || '',
        score: num(paper.score),
        hfUpvotes: num(paper.hf_upvotes),
        sourceCount: num(paper.source_count, 1),
      };
    })
    .sort((a, b) => b.score - a.score);
  const runRow = pipelineRuns.find((r) => r.date === latestDate);
  const weights = (runRow && runRow.weights_snapshot) || {};
  return {
    papers: enriched,
    weights: {
      w1: num(weights.w1),
      w2: num(weights.w2),
      w3: num(weights.w3),
      w4: num(weights.w4),
    },
  };
}

/**
 * Aggregate feedback by tag (top 8) producing labels + like/dislike series.
 */
function aggregateFeedbackByCategory(feedback, summaries) {
  if (!feedback || feedback.length === 0) return { labels: [], like: [], dislike: [] };
  const tagsByPaper = new Map();
  for (const s of summaries) {
    if (!s.arxiv_id) continue;
    tagsByPaper.set(s.arxiv_id, Array.isArray(s.tags) ? s.tags : []);
  }
  const counts = new Map(); // tag -> { like, dislike }
  for (const f of feedback) {
    const reaction = f.reaction;
    if (reaction !== 'like' && reaction !== 'dislike') continue;
    const tags = tagsByPaper.get(f.arxiv_id) || [];
    if (tags.length === 0) {
      const bucket = counts.get('(タグなし)') || { like: 0, dislike: 0 };
      bucket[reaction] += 1;
      counts.set('(タグなし)', bucket);
      continue;
    }
    for (const tag of tags) {
      const bucket = counts.get(tag) || { like: 0, dislike: 0 };
      bucket[reaction] += 1;
      counts.set(tag, bucket);
    }
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => (b[1].like + b[1].dislike) - (a[1].like + a[1].dislike))
    .slice(0, 8);
  return {
    labels: ranked.map(([tag]) => tag),
    like: ranked.map(([, v]) => v.like),
    dislike: ranked.map(([, v]) => v.dislike),
  };
}

/**
 * Convert weight history rows into Chart.js time-series datasets.
 */
function aggregateWeightHistory(history) {
  const safe = Array.isArray(history) ? history : [];
  if (safe.length === 0) return { labels: [], datasets: [] };
  const sorted = [...safe].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const labels = sorted.map((h) => h.date || '');
  const keys = ['w1', 'w2', 'w3', 'w4'];
  const labelMap = { w1: 'w1 (HF)', w2: 'w2 (引用)', w3: 'w3 (ソース)', w4: 'w4 (フィードバック)' };
  return {
    labels,
    datasets: keys.map((k) => ({
      key: k,
      label: labelMap[k],
      data: sorted.map((h) => num(h[k])),
    })),
  };
}

/**
 * Reduce pipeline-runs into per-stage status arrays for the health chart.
 * Each cell is 1 (success), 0 (error), or null (missing).
 */
function aggregatePipelineHealth(pipelineRuns, targetDate) {
  const labels = dateRange(targetDate, DASHBOARD_HEALTH_DAYS);
  const byDate = indexByDate(pipelineRuns);
  const stages = ['collector', 'scorer', 'summarizer', 'deliverer'];
  return {
    labels,
    stages: stages.map((stage) => ({
      label: stage,
      data: labels.map((d) => {
        const row = byDate.get(d);
        if (!row) return null;
        const status = row[`${stage}_status`];
        if (status === 'success') return 1;
        if (status === 'error') return 0;
        return null;
      }),
    })),
  };
}

/**
 * Cost + token series for the trailing window.
 */
function aggregateCost(pipelineRuns, targetDate) {
  const labels = dateRange(targetDate, DASHBOARD_WINDOW_DAYS);
  const byDate = indexByDate(pipelineRuns);
  return {
    labels,
    costUsd: labels.map((d) => Number(num(byDate.get(d) && byDate.get(d).claude_cost_usd).toFixed(4))),
    inputTokens: labels.map((d) => num(byDate.get(d) && byDate.get(d).claude_input_tokens)),
    outputTokens: labels.map((d) => num(byDate.get(d) && byDate.get(d).claude_output_tokens)),
  };
}

/**
 * Daily delivery counts.
 */
function aggregateDelivery(pipelineRuns, targetDate) {
  const labels = dateRange(targetDate, DASHBOARD_WINDOW_DAYS);
  const byDate = indexByDate(pipelineRuns);
  return {
    labels,
    delivered: labels.map((d) => num(byDate.get(d) && byDate.get(d).papers_delivered)),
  };
}

/**
 * Sample the weight_adjuster_skipped flag from pipeline-runs to display
 * the learning-loop activity over the trailing window.
 */
function aggregateLearningLoop(pipelineRuns, weightHistory, targetDate) {
  const labels = dateRange(targetDate, DASHBOARD_WINDOW_DAYS);
  const byDate = indexByDate(pipelineRuns);
  const history = [];
  for (const d of labels) {
    const row = byDate.get(d);
    if (!row) continue;
    if (row.weight_adjuster_status === undefined && row.weight_adjuster_skipped === undefined) continue;
    history.push({
      date: d,
      skipped: row.weight_adjuster_skipped === true,
    });
  }
  if (history.length === 0 && Array.isArray(weightHistory)) {
    for (const h of weightHistory) {
      history.push({ date: h.date || '', skipped: h.skipped === true });
    }
  }
  return { history };
}

/**
 * Compute on-the-fly diversity metrics from the latest digest.
 */
function computeDiversity(summaries, papersById) {
  if (!summaries || summaries.length === 0) {
    return { hfCount: 0, arxivOnlyCount: 0, categories: {}, authorOverlapRate: 0 };
  }
  const dates = [...new Set(summaries.map((s) => s.date).filter(Boolean))].sort();
  const latestDate = dates[dates.length - 1];
  const latest = summaries.filter((s) => s.date === latestDate);
  let hfCount = 0;
  let arxivOnlyCount = 0;
  const categories = {};
  const authorSets = [];
  for (const s of latest) {
    const paper = papersById.get(s.arxiv_id);
    if (!paper) continue;
    if (num(paper.hf_upvotes) > 0) hfCount += 1;
    else arxivOnlyCount += 1;
    const cats = Array.isArray(paper.categories) ? paper.categories : [];
    for (const c of cats) categories[c] = (categories[c] || 0) + 1;
    const authors = Array.isArray(paper.authors) ? paper.authors : [];
    if (authors.length > 0) authorSets.push(new Set(authors.map((a) => String(a).toLowerCase())));
  }
  // Average pairwise Jaccard
  let overlapSum = 0;
  let pairs = 0;
  for (let i = 0; i < authorSets.length; i++) {
    for (let j = i + 1; j < authorSets.length; j++) {
      const a = authorSets[i];
      const b = authorSets[j];
      let inter = 0;
      for (const v of a) if (b.has(v)) inter += 1;
      const union = a.size + b.size - inter;
      if (union > 0) overlapSum += inter / union;
      pairs += 1;
    }
  }
  const authorOverlapRate = pairs > 0 ? Number((overlapSum / pairs).toFixed(4)) : 0;
  return { hfCount, arxivOnlyCount, categories, authorOverlapRate };
}

/**
 * Win-rate and average score per day from summaries.quality_winner / quality_score.
 */
function aggregateQuality(summaries, targetDate) {
  const labels = dateRange(targetDate, DASHBOARD_WINDOW_DAYS);
  const buckets = new Map(); // date -> { claude, hf, scoreSum, scoreCount }
  for (const s of summaries) {
    if (!s.date) continue;
    const bucket = buckets.get(s.date) || { claude: 0, hf: 0, scoreSum: 0, scoreCount: 0 };
    if (s.quality_winner === 'claude') bucket.claude += 1;
    else if (s.quality_winner === 'hf') bucket.hf += 1;
    if (typeof s.quality_score === 'number') {
      bucket.scoreSum += s.quality_score;
      bucket.scoreCount += 1;
    }
    buckets.set(s.date, bucket);
  }
  return {
    labels,
    winRateClaude: labels.map((d) => {
      const b = buckets.get(d);
      if (!b) return 0;
      const total = b.claude + b.hf;
      return total > 0 ? Number((b.claude / total).toFixed(4)) : 0;
    }),
    winRateHf: labels.map((d) => {
      const b = buckets.get(d);
      if (!b) return 0;
      const total = b.claude + b.hf;
      return total > 0 ? Number((b.hf / total).toFixed(4)) : 0;
    }),
    avgScore: labels.map((d) => {
      const b = buckets.get(d);
      if (!b || b.scoreCount === 0) return 0;
      return Number((b.scoreSum / b.scoreCount).toFixed(4));
    }),
  };
}

/**
 * Render dashboard.html from the in-memory ``data`` object.
 */
function renderDashboard(data) {
  const template = fs.readFileSync(path.join(TEMPLATES_DIR, 'dashboard.html'), 'utf-8');
  const summary = (data && data.summary) || {};
  const generatedAt = data && data.generatedAt ? data.generatedAt : '';
  const cardCollected = String(summary.collectedTotal7d || 0);
  const cardSelected = String(summary.selectedTotal7d || 0);
  const cardDelivered = String(summary.deliveredTotal7d || 0);
  const cardCost = `$${(summary.claudeCost7dUsd || 0).toFixed(2)}`;
  const json = JSON.stringify(data || {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return template
    .replace(/\{\{generated_at\}\}/g, escapeHtml(generatedAt))
    .replace(/\{\{card_collected\}\}/g, escapeHtml(cardCollected))
    .replace(/\{\{card_selected\}\}/g, escapeHtml(cardSelected))
    .replace(/\{\{card_delivered\}\}/g, escapeHtml(cardDelivered))
    .replace(/\{\{card_cost\}\}/g, escapeHtml(cardCost))
    .replace(/\{\{data_json\}\}/g, json);
}

/**
 * Generate the monitoring dashboard for ``targetDate`` (YYYY-MM-DD).
 * Failures are caught by the caller — this function may throw.
 */
async function generateMonitoring(targetDate) {
  console.log('[dashboard] Generating monitoring dashboard...');
  const [pipelineRuns, summaries, feedback, weightHistory] = await Promise.all([
    fetchPipelineRunsLast30Days(targetDate),
    fetchSummariesLast30Days(targetDate),
    fetchFeedbackLast30Days(targetDate),
    fetchWeightHistory(),
  ]);
  const papersById = await fetchPapersForSummaries(summaries);
  const data = {
    generatedAt: new Date().toISOString(),
    targetDate,
    summary: computeSummaryCards(pipelineRuns, targetDate),
    charts: {
      collection: aggregateCollectionVolume(pipelineRuns, targetDate),
      scoreBreakdown: aggregateLatestScores(summaries, papersById, pipelineRuns),
      feedback: aggregateFeedbackByCategory(feedback, summaries),
      weights: aggregateWeightHistory(weightHistory),
      pipelineHealth: aggregatePipelineHealth(pipelineRuns, targetDate),
      cost: aggregateCost(pipelineRuns, targetDate),
      delivery: aggregateDelivery(pipelineRuns, targetDate),
      learningLoop: aggregateLearningLoop(pipelineRuns, weightHistory, targetDate),
      diversity: computeDiversity(summaries, papersById),
      quality: aggregateQuality(summaries, targetDate),
    },
  };
  const html = renderDashboard(data);
  await upload('dashboard.html', html);
  console.log(
    `[dashboard] Monitoring dashboard uploaded (pipeline-runs=${pipelineRuns.length}, summaries=${summaries.length}, feedback=${feedback.length}).`
  );
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
  // monitoring
  generateMonitoring,
  renderDashboard,
  computeSummaryCards,
  aggregateCollectionVolume,
  aggregateLatestScores,
  aggregateFeedbackByCategory,
  aggregateWeightHistory,
  aggregatePipelineHealth,
  aggregateCost,
  aggregateDelivery,
  aggregateLearningLoop,
  computeDiversity,
  aggregateQuality,
  dateRange,
  // for tests
  fetchPipelineRunsLast30Days,
  fetchSummariesLast30Days,
  fetchFeedbackLast30Days,
  fetchWeightHistory,
};
