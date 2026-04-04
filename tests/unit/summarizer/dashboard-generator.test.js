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
