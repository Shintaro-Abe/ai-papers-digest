"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateTags,
  renderTagList,
  renderTagPage,
  renderSearchPage,
  buildSearchIndex,
  renderIndex,
  // monitoring exports
  dateRange,
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
  renderDashboard,
} = require("../../../src/summarizer/src/dashboard-generator");

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function makeSummary(overrides = {}) {
  return {
    arxiv_id: "2501.00001",
    title_original: "A Novel Approach",
    title_ja: "新しいアプローチ",
    compact_summary: "本論文は新手法を提案する。",
    tags: ["LLM", "Transformer"],
    date: "2026-04-01",
    is_active: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// aggregateTags
// ---------------------------------------------------------------------------

describe("aggregateTags", () => {
  it("groups summaries by tag", () => {
    const summaries = [
      makeSummary({ arxiv_id: "001", tags: ["LLM", "NLP"] }),
      makeSummary({ arxiv_id: "002", tags: ["LLM", "Vision"] }),
      makeSummary({ arxiv_id: "003", tags: ["Vision"] }),
    ];
    const tagMap = aggregateTags(summaries);

    assert.equal(tagMap.size, 3);
    assert.equal(tagMap.get("LLM").length, 2);
    assert.equal(tagMap.get("NLP").length, 1);
    assert.equal(tagMap.get("Vision").length, 2);
  });

  it("returns sorted tags", () => {
    const summaries = [
      makeSummary({ tags: ["Zzz"] }),
      makeSummary({ tags: ["Aaa"] }),
      makeSummary({ tags: ["Mmm"] }),
    ];
    const tagMap = aggregateTags(summaries);
    const keys = [...tagMap.keys()];

    assert.deepEqual(keys, ["Aaa", "Mmm", "Zzz"]);
  });

  it("handles summaries with no tags", () => {
    const summaries = [
      makeSummary({ tags: [] }),
      makeSummary({ tags: undefined }),
    ];
    const tagMap = aggregateTags(summaries);

    assert.equal(tagMap.size, 0);
  });

  it("handles empty summaries array", () => {
    const tagMap = aggregateTags([]);
    assert.equal(tagMap.size, 0);
  });

  it("handles Japanese tags", () => {
    const summaries = [
      makeSummary({ tags: ["強化学習", "深層学習"] }),
      makeSummary({ tags: ["強化学習"] }),
    ];
    const tagMap = aggregateTags(summaries);

    assert.equal(tagMap.get("強化学習").length, 2);
    assert.equal(tagMap.get("深層学習").length, 1);
  });
});

// ---------------------------------------------------------------------------
// renderTagList
// ---------------------------------------------------------------------------

describe("renderTagList", () => {
  it("renders tag count", () => {
    const tagMap = new Map([
      ["LLM", [makeSummary(), makeSummary()]],
      ["NLP", [makeSummary()]],
    ]);
    const html = renderTagList(tagMap);

    assert.ok(html.includes("2 tags"));
  });

  it("renders tag names and paper counts", () => {
    const tagMap = new Map([
      ["LLM", [makeSummary(), makeSummary(), makeSummary()]],
    ]);
    const html = renderTagList(tagMap);

    assert.ok(html.includes("LLM"));
    assert.ok(html.includes("3 件"));
  });

  it("renders valid HTML structure", () => {
    const tagMap = new Map([["Test", [makeSummary()]]]);
    const html = renderTagList(tagMap);

    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("AI Papers Digest"));
    assert.ok(html.includes("/tags/"));
  });

  it("escapes special characters in tag names", () => {
    const tagMap = new Map([['<script>alert("xss")</script>', [makeSummary()]]]);
    const html = renderTagList(tagMap);

    assert.ok(!html.includes("<script>alert"));
    assert.ok(html.includes("&lt;script&gt;"));
  });
});

// ---------------------------------------------------------------------------
// renderTagPage
// ---------------------------------------------------------------------------

describe("renderTagPage", () => {
  it("renders tag name and paper count", () => {
    const summaries = [makeSummary(), makeSummary()];
    const html = renderTagPage("LLM", summaries);

    assert.ok(html.includes("LLM"));
    assert.ok(html.includes("2 papers"));
  });

  it("renders paper cards with titles and links", () => {
    const summaries = [
      makeSummary({ arxiv_id: "2501.00001", title_ja: "テスト論文" }),
    ];
    const html = renderTagPage("Test", summaries);

    assert.ok(html.includes("テスト論文"));
    assert.ok(html.includes("/papers/2501.00001.html"));
  });

  it("sorts papers by date descending", () => {
    const summaries = [
      makeSummary({ arxiv_id: "old", date: "2026-01-01", title_ja: "古い" }),
      makeSummary({ arxiv_id: "new", date: "2026-04-01", title_ja: "新しい" }),
    ];
    const html = renderTagPage("Test", summaries);

    const posNew = html.indexOf("新しい");
    const posOld = html.indexOf("古い");
    assert.ok(posNew < posOld, "newer paper should appear first");
  });

  it("renders tags for each paper", () => {
    const summaries = [makeSummary({ tags: ["LLM", "NLP"] })];
    const html = renderTagPage("LLM", summaries);

    assert.ok(html.includes('<span class="tag">LLM</span>'));
    assert.ok(html.includes('<span class="tag">NLP</span>'));
  });

  it("escapes HTML in paper content", () => {
    const summaries = [
      makeSummary({ title_ja: '<img src=x onerror=alert("xss")>' }),
    ];
    const html = renderTagPage("Test", summaries);

    assert.ok(!html.includes("<img src=x"));
  });
});

// ---------------------------------------------------------------------------
// renderSearchPage
// ---------------------------------------------------------------------------

describe("renderSearchPage", () => {
  it("returns valid HTML", () => {
    const html = renderSearchPage();

    assert.equal(typeof html, "string");
    assert.ok(html.includes("<!DOCTYPE html>"));
  });

  it("includes search input", () => {
    const html = renderSearchPage();

    assert.ok(html.includes('id="search-input"'));
  });

  it("includes lunr.js script", () => {
    const html = renderSearchPage();

    assert.ok(html.includes("lunr"));
  });

  it("includes search.js script", () => {
    const html = renderSearchPage();

    assert.ok(html.includes("/assets/search.js"));
  });
});

// ---------------------------------------------------------------------------
// buildSearchIndex
// ---------------------------------------------------------------------------

describe("buildSearchIndex", () => {
  it("returns valid JSON with version and papers", () => {
    const summaries = [makeSummary()];
    const json = buildSearchIndex(summaries);
    const data = JSON.parse(json);

    assert.equal(data.version, 1);
    assert.equal(Array.isArray(data.papers), true);
    assert.equal(data.papers.length, 1);
  });

  it("maps summary fields correctly", () => {
    const summaries = [
      makeSummary({
        arxiv_id: "2604.00001",
        title_original: "Test Paper",
        title_ja: "テスト論文",
        compact_summary: "要約です",
        tags: ["LLM", "NLP"],
        date: "2026-04-04",
      }),
    ];
    const data = JSON.parse(buildSearchIndex(summaries));
    const paper = data.papers[0];

    assert.equal(paper.id, "2604.00001");
    assert.equal(paper.title, "Test Paper");
    assert.equal(paper.title_ja, "テスト論文");
    assert.equal(paper.compact_summary, "要約です");
    assert.equal(paper.tags, "LLM NLP");
    assert.equal(paper.date, "2026-04-04");
    assert.equal(paper.url, "/papers/2604.00001.html");
  });

  it("handles empty summaries", () => {
    const data = JSON.parse(buildSearchIndex([]));

    assert.equal(data.papers.length, 0);
  });

  it("handles missing fields gracefully", () => {
    const summaries = [{ arxiv_id: "001" }];
    const data = JSON.parse(buildSearchIndex(summaries));
    const paper = data.papers[0];

    assert.equal(paper.title, "");
    assert.equal(paper.title_ja, "");
    assert.equal(paper.tags, "");
  });

  it("joins tags with spaces", () => {
    const summaries = [makeSummary({ tags: ["A", "B", "C"] })];
    const data = JSON.parse(buildSearchIndex(summaries));

    assert.equal(data.papers[0].tags, "A B C");
  });
});

// ---------------------------------------------------------------------------
// renderIndex
// ---------------------------------------------------------------------------

describe("renderIndex", () => {
  it("renders redirect to given date", () => {
    const html = renderIndex("2026-04-04");

    assert.ok(html.includes("/digest/2026-04-04.html"));
  });

  it("includes meta refresh tag", () => {
    const html = renderIndex("2026-04-04");

    assert.ok(html.includes('http-equiv="refresh"'));
  });

  it("returns valid HTML", () => {
    const html = renderIndex("2026-04-04");

    assert.ok(html.includes("<!DOCTYPE html>"));
  });

  it("escapes date in output", () => {
    const html = renderIndex('<script>alert("xss")</script>');

    assert.ok(!html.includes("<script>alert"));
  });
});

// ---------------------------------------------------------------------------
// Monitoring dashboard — date helpers + aggregations
// ---------------------------------------------------------------------------

describe("dateRange", () => {
  it("generates inclusive trailing window ending at endDate", () => {
    const range = dateRange("2026-05-01", 7);
    assert.equal(range.length, 7);
    assert.equal(range[6], "2026-05-01");
    assert.equal(range[0], "2026-04-25");
  });

  it("accepts a Date instance", () => {
    const range = dateRange(new Date("2026-05-01T00:00:00Z"), 3);
    assert.deepEqual(range, ["2026-04-29", "2026-04-30", "2026-05-01"]);
  });
});

describe("computeSummaryCards", () => {
  const runs = [
    { date: "2026-04-25", papers_collected_total: 50, papers_selected: 7, papers_delivered: 7, claude_cost_usd: 0.10 },
    { date: "2026-04-26", papers_collected_hf: 20, papers_collected_arxiv: 30, papers_selected: 6, papers_delivered: 6, claude_cost_usd: 0.20 },
    { date: "2026-04-27", papers_collected_total: 40, papers_selected: 5, papers_delivered: 5, claude_cost_usd: 0.15 },
    { date: "2026-04-19", papers_collected_total: 999, papers_selected: 99, papers_delivered: 99, claude_cost_usd: 9.99 },
  ];

  it("sums values inside the trailing 7-day window only", () => {
    const cards = computeSummaryCards(runs, "2026-05-01");
    assert.equal(cards.collectedTotal7d, 50 + 50 + 40);
    assert.equal(cards.selectedTotal7d, 18);
    assert.equal(cards.deliveredTotal7d, 18);
    assert.equal(cards.claudeCost7dUsd, 0.45);
  });

  it("falls back to HF + arXiv when papers_collected_total is missing", () => {
    const cards = computeSummaryCards(
      [{ date: "2026-04-30", papers_collected_hf: 5, papers_collected_arxiv: 7 }],
      "2026-05-01"
    );
    assert.equal(cards.collectedTotal7d, 12);
  });

  it("returns zeros when no rows match", () => {
    const cards = computeSummaryCards([], "2026-05-01");
    assert.equal(cards.collectedTotal7d, 0);
    assert.equal(cards.claudeCost7dUsd, 0);
  });
});

describe("aggregateCollectionVolume", () => {
  it("aligns HF/arXiv arrays with labels and pads missing days with zero", () => {
    const result = aggregateCollectionVolume(
      [
        { date: "2026-04-30", papers_collected_hf: 3, papers_collected_arxiv: 7 },
        { date: "2026-05-01", papers_collected_hf: 4, papers_collected_arxiv: 9 },
      ],
      "2026-05-01"
    );
    assert.equal(result.labels.length, 30);
    assert.equal(result.labels[result.labels.length - 1], "2026-05-01");
    assert.equal(result.hf[result.hf.length - 1], 4);
    assert.equal(result.arxiv[result.arxiv.length - 1], 9);
    assert.equal(result.hf[result.hf.length - 2], 3);
    assert.equal(result.hf[0], 0);
  });
});

describe("aggregateLatestScores", () => {
  it("returns latest-day papers ranked by score with the matching weight snapshot", () => {
    const summaries = [
      { arxiv_id: "p1", date: "2026-04-30", title_ja: "古い", quality_winner: "claude" },
      { arxiv_id: "p2", date: "2026-05-01", title_ja: "新しい A" },
      { arxiv_id: "p3", date: "2026-05-01", title_ja: "新しい B" },
    ];
    const papersById = new Map([
      ["p2", { arxiv_id: "p2", score: 0.85, hf_upvotes: 10, source_count: 2 }],
      ["p3", { arxiv_id: "p3", score: 0.42, hf_upvotes: 0, source_count: 1 }],
    ]);
    const pipelineRuns = [
      { date: "2026-05-01", weights_snapshot: { w1: 0.3, w2: 0.2, w3: 0.2, w4: 0.3 } },
    ];
    const result = aggregateLatestScores(summaries, papersById, pipelineRuns);
    assert.equal(result.papers.length, 2);
    assert.equal(result.papers[0].arxivId, "p2");
    assert.equal(result.papers[1].arxivId, "p3");
    assert.equal(result.weights.w1, 0.3);
    assert.equal(result.weights.w4, 0.3);
  });

  it("returns empty payload when no summaries", () => {
    const result = aggregateLatestScores([], new Map(), []);
    assert.deepEqual(result.papers, []);
  });
});

describe("aggregateFeedbackByCategory", () => {
  const summaries = [
    { arxiv_id: "p1", tags: ["LLM", "RL"] },
    { arxiv_id: "p2", tags: ["LLM"] },
    { arxiv_id: "p3", tags: [] },
  ];
  const feedback = [
    { arxiv_id: "p1", reaction: "like" },
    { arxiv_id: "p1", reaction: "like" },
    { arxiv_id: "p2", reaction: "dislike" },
    { arxiv_id: "p3", reaction: "like" },
    { arxiv_id: "p1", reaction: "ignore" }, // unknown reaction filtered out
  ];

  it("groups feedback by tag and ranks by total interactions", () => {
    const result = aggregateFeedbackByCategory(feedback, summaries);
    const idx = result.labels.indexOf("LLM");
    assert.ok(idx !== -1);
    assert.equal(result.like[idx], 2);
    assert.equal(result.dislike[idx], 1);
    const noTagIdx = result.labels.indexOf("(タグなし)");
    assert.equal(result.like[noTagIdx], 1);
  });

  it("returns empty arrays when no feedback", () => {
    const result = aggregateFeedbackByCategory([], summaries);
    assert.deepEqual(result, { labels: [], like: [], dislike: [] });
  });
});

describe("aggregateWeightHistory", () => {
  it("converts history records into time-series datasets", () => {
    const history = [
      { date: "2026-04-26", w1: 0.3, w2: 0.21, w3: 0.2, w4: 0.29 },
      { date: "2026-04-19", w1: 0.32, w2: 0.2, w3: 0.18, w4: 0.3 },
    ];
    const result = aggregateWeightHistory(history);
    assert.deepEqual(result.labels, ["2026-04-19", "2026-04-26"]);
    const w1 = result.datasets.find((d) => d.key === "w1");
    assert.deepEqual(w1.data, [0.32, 0.3]);
  });

  it("returns empty when history is missing", () => {
    assert.deepEqual(aggregateWeightHistory(null), { labels: [], datasets: [] });
  });
});

describe("aggregatePipelineHealth", () => {
  it("encodes success/error/missing as 1/0/null per stage", () => {
    const runs = [
      {
        date: "2026-05-01",
        collector_status: "success",
        scorer_status: "error",
        summarizer_status: "success",
        // deliverer missing -> null
      },
    ];
    const result = aggregatePipelineHealth(runs, "2026-05-01");
    assert.equal(result.labels.length, 14);
    assert.equal(result.stages.length, 4);
    const collector = result.stages.find((s) => s.label === "collector");
    const scorer = result.stages.find((s) => s.label === "scorer");
    const deliverer = result.stages.find((s) => s.label === "deliverer");
    assert.equal(collector.data[collector.data.length - 1], 1);
    assert.equal(scorer.data[scorer.data.length - 1], 0);
    assert.equal(deliverer.data[deliverer.data.length - 1], null);
  });
});

describe("aggregateCost / aggregateDelivery", () => {
  const runs = [
    { date: "2026-05-01", claude_cost_usd: 0.123456, claude_input_tokens: 12000, claude_output_tokens: 3000, papers_delivered: 7 },
  ];

  it("rounds cost to 4 decimals and exposes token series", () => {
    const cost = aggregateCost(runs, "2026-05-01");
    assert.equal(cost.costUsd[cost.costUsd.length - 1], 0.1235);
    assert.equal(cost.inputTokens[cost.inputTokens.length - 1], 12000);
    assert.equal(cost.outputTokens[cost.outputTokens.length - 1], 3000);
  });

  it("returns delivery counts aligned with the date axis", () => {
    const delivery = aggregateDelivery(runs, "2026-05-01");
    assert.equal(delivery.delivered[delivery.delivered.length - 1], 7);
    assert.equal(delivery.delivered[0], 0);
  });
});

describe("aggregateLearningLoop", () => {
  it("records skipped flag for runs that have weight_adjuster activity", () => {
    const runs = [
      { date: "2026-04-26", weight_adjuster_status: "success", weight_adjuster_skipped: false },
      { date: "2026-05-01", weight_adjuster_status: "success", weight_adjuster_skipped: true },
    ];
    const result = aggregateLearningLoop(runs, [], "2026-05-01");
    assert.equal(result.history.length, 2);
    assert.equal(result.history[1].skipped, true);
  });

  it("falls back to weight history when pipeline-runs lack weight_adjuster activity", () => {
    const result = aggregateLearningLoop([], [{ date: "2026-04-26", skipped: false }], "2026-05-01");
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].date, "2026-04-26");
  });
});

describe("computeDiversity", () => {
  const summaries = [
    { arxiv_id: "p1", date: "2026-05-01" },
    { arxiv_id: "p2", date: "2026-05-01" },
    { arxiv_id: "p3", date: "2026-04-26" },
  ];
  const papersById = new Map([
    ["p1", { hf_upvotes: 5, categories: ["cs.LG", "cs.CL"], authors: ["Alice", "Bob"] }],
    ["p2", { hf_upvotes: 0, categories: ["cs.LG"], authors: ["Alice", "Carol"] }],
    ["p3", { hf_upvotes: 2, categories: ["cs.AI"], authors: ["Dave"] }],
  ]);

  it("counts HF vs arXiv-only papers from the latest day", () => {
    const result = computeDiversity(summaries, papersById);
    assert.equal(result.hfCount, 1);
    assert.equal(result.arxivOnlyCount, 1);
    assert.equal(result.categories["cs.LG"], 2);
    assert.equal(result.categories["cs.AI"], undefined);
  });

  it("computes pairwise Jaccard for author overlap", () => {
    const result = computeDiversity(summaries, papersById);
    // Alice/Bob ∩ Alice/Carol = {Alice}, ∪ = {Alice,Bob,Carol} → 1/3
    assert.ok(Math.abs(result.authorOverlapRate - 0.3333) < 0.001);
  });

  it("returns zeros for empty input", () => {
    const result = computeDiversity([], new Map());
    assert.equal(result.hfCount, 0);
    assert.equal(result.authorOverlapRate, 0);
  });
});

describe("aggregateQuality", () => {
  it("computes claude/hf win rates and average score per day", () => {
    const summaries = [
      { date: "2026-05-01", quality_winner: "claude", quality_score: 0.8 },
      { date: "2026-05-01", quality_winner: "hf", quality_score: 0.4 },
      { date: "2026-05-01", quality_winner: "claude", quality_score: 0.9 },
      { date: "2026-04-30", quality_winner: null, quality_score: 0.2 }, // ignored for win rate
    ];
    const result = aggregateQuality(summaries, "2026-05-01");
    const last = result.labels.length - 1;
    assert.ok(Math.abs(result.winRateClaude[last] - 2 / 3) < 0.001);
    assert.ok(Math.abs(result.winRateHf[last] - 1 / 3) < 0.001);
    assert.ok(Math.abs(result.avgScore[last] - 0.7) < 0.001);
    // 2026-04-30 had no winner, so win rates must be 0
    const prev = last - 1;
    assert.equal(result.winRateClaude[prev], 0);
    assert.equal(result.winRateHf[prev], 0);
    assert.ok(Math.abs(result.avgScore[prev] - 0.2) < 0.001);
  });
});

describe("renderDashboard", () => {
  const data = {
    generatedAt: "2026-05-01T03:21:00Z",
    summary: { collectedTotal7d: 100, selectedTotal7d: 50, deliveredTotal7d: 49, claudeCost7dUsd: 1.234 },
    charts: {
      collection: { labels: ["2026-05-01"], hf: [3], arxiv: [4] },
    },
  };

  it("substitutes summary values into the template", () => {
    const html = renderDashboard(data);
    assert.ok(html.includes("100"));
    assert.ok(html.includes("$1.23"));
    assert.ok(html.includes("2026-05-01T03:21:00Z"));
  });

  it("escapes user-controlled JSON to prevent script breakout", () => {
    const html = renderDashboard({
      ...data,
      charts: { evil: { label: "</script><script>alert(1)</script>" } },
    });
    // The data island content must not break out of the script tag
    assert.ok(!/<\/script><script>alert/.test(html));
    assert.ok(html.includes("\\u003c/script"));
  });

  it("contains the dashboard.js script tag and Chart.js CDN", () => {
    const html = renderDashboard(data);
    assert.ok(html.includes("/assets/dashboard.js"));
    assert.ok(html.includes("cdn.jsdelivr.net/npm/chart.js"));
  });
});
