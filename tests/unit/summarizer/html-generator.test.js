"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, renderDetail, renderDigest } = require("../../../src/summarizer/src/html-generator");

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function makePaper(overrides = {}) {
  return {
    arxiv_id: "2501.00001",
    title: "A Novel Approach to Transformer Optimization",
    authors: ["Alice Smith", "Bob Jones"],
    categories: ["cs.LG", "cs.AI"],
    published_at: "2025-01-01",
    upvotes: 42,
    num_citations: 7,
    score: 88,
    github_url: "https://github.com/example/repo",
    ...overrides,
  };
}

function makeSummary(overrides = {}) {
  return {
    arxiv_id: "2501.00001",
    title_original: "A Novel Approach to Transformer Optimization",
    title_ja: "Transformer最適化への新しいアプローチ",
    compact_summary: "本論文はTransformerモデルの効率化手法を提案する。",
    detail: {
      novelty: "新しい注意機構を導入",
      method: "蒸留と量子化を組み合わせる",
      results: "推論速度が2倍に向上",
      practicality: "エッジデバイスへの展開が容易",
    },
    tags: ["Transformer", "最適化", "効率化"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  it("escapes & character", () => {
    assert.equal(escapeHtml("foo & bar"), "foo &amp; bar");
  });

  it("escapes < character", () => {
    assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  });

  it("escapes > character", () => {
    assert.equal(escapeHtml("a > b"), "a &gt; b");
  });

  it('escapes " character', () => {
    assert.equal(escapeHtml('say "hello"'), "say &quot;hello&quot;");
  });

  it("escapes ' character", () => {
    assert.equal(escapeHtml("it's"), "it&#x27;s");
  });

  it("escapes all special characters together", () => {
    assert.equal(
      escapeHtml(`<a href="x" class='y'>&</a>`),
      "&lt;a href=&quot;x&quot; class=&#x27;y&#x27;&gt;&amp;&lt;/a&gt;"
    );
  });

  it("returns empty string for empty input", () => {
    assert.equal(escapeHtml(""), "");
  });

  it("returns empty string for null", () => {
    assert.equal(escapeHtml(null), "");
  });

  it("returns empty string for undefined", () => {
    assert.equal(escapeHtml(undefined), "");
  });

  it("returns the same string when no special characters present", () => {
    assert.equal(escapeHtml("hello world 123"), "hello world 123");
  });
});

// ---------------------------------------------------------------------------
// renderDetail
// ---------------------------------------------------------------------------

describe("renderDetail", () => {
  it("returns an HTML string", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.equal(typeof html, "string");
    assert.ok(html.startsWith("<!DOCTYPE html>"));
  });

  it("contains the paper title (Japanese)", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("Transformer最適化への新しいアプローチ"));
  });

  it("contains the original title", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("A Novel Approach to Transformer Optimization"));
  });

  it("contains authors", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("Alice Smith, Bob Jones"));
  });

  it("contains categories", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("cs.LG, cs.AI"));
  });

  it("contains the compact summary", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("本論文はTransformerモデルの効率化手法を提案する。"));
  });

  it("contains detail_novelty section", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("新しい注意機構を導入"));
  });

  it("contains detail_method section", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("蒸留と量子化を組み合わせる"));
  });

  it("contains detail_results section", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("推論速度が2倍に向上"));
  });

  it("contains detail_practicality section", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("エッジデバイスへの展開が容易"));
  });

  it("contains tags", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("Transformer"));
    assert.ok(html.includes("最適化"));
    assert.ok(html.includes("効率化"));
    assert.ok(html.includes('class="tag"'));
  });

  it("contains arxiv link", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("https://arxiv.org/abs/2501.00001"));
  });

  it("contains github link when url is provided", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("https://github.com/example/repo"));
    assert.ok(html.includes("GitHub"));
  });

  it("omits github link when url is not provided", () => {
    const html = renderDetail(makePaper({ github_url: "" }), makeSummary());
    assert.ok(!html.includes("btn btn-secondary"));
  });

  it("escapes HTML special characters in paper title", () => {
    const summary = makeSummary({
      title_ja: '<script>alert("xss")</script>',
    });
    const html = renderDetail(makePaper(), summary);
    assert.ok(!html.includes('<script>alert("xss")</script>'));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("escapes HTML special characters in authors", () => {
    const paper = makePaper({ authors: ["O'Brien & <Co>"] });
    const html = renderDetail(paper, makeSummary());
    assert.ok(html.includes("O&#x27;Brien &amp; &lt;Co&gt;"));
  });

  it("handles flat detail fields (detail_novelty etc.)", () => {
    const summary = makeSummary({
      detail: undefined,
      detail_novelty: "Flat novelty value",
      detail_method: "Flat method value",
      detail_results: "Flat results value",
      detail_practicality: "Flat practicality value",
    });
    const html = renderDetail(makePaper(), summary);
    assert.ok(html.includes("Flat novelty value"));
    assert.ok(html.includes("Flat method value"));
    assert.ok(html.includes("Flat results value"));
    assert.ok(html.includes("Flat practicality value"));
  });

  it("contains upvotes, citations, and score", () => {
    const html = renderDetail(makePaper(), makeSummary());
    assert.ok(html.includes("42"));
    assert.ok(html.includes("7"));
    assert.ok(html.includes("88"));
  });
});

// ---------------------------------------------------------------------------
// renderDigest
// ---------------------------------------------------------------------------

describe("renderDigest", () => {
  const date = "2025-01-15";

  function makeDigestSummary(overrides = {}) {
    return {
      arxiv_id: "2501.00001",
      title_original: "A Novel Approach",
      title_ja: "新しいアプローチ",
      compact_summary: "要約テキスト",
      tags: ["LLM", "効率化"],
      ...overrides,
    };
  }

  it("returns an HTML string", () => {
    const html = renderDigest(date, [makeDigestSummary()]);
    assert.equal(typeof html, "string");
    assert.ok(html.startsWith("<!DOCTYPE html>"));
  });

  it("contains the date", () => {
    const html = renderDigest(date, [makeDigestSummary()]);
    assert.ok(html.includes("2025-01-15"));
  });

  it("contains the paper count", () => {
    const summaries = [
      makeDigestSummary({ arxiv_id: "2501.00001" }),
      makeDigestSummary({ arxiv_id: "2501.00002" }),
      makeDigestSummary({ arxiv_id: "2501.00003" }),
    ];
    const html = renderDigest(date, summaries);
    assert.ok(html.includes("3 件の論文"));
  });

  it("contains paper cards with titles", () => {
    const html = renderDigest(date, [makeDigestSummary()]);
    assert.ok(html.includes("新しいアプローチ"));
    assert.ok(html.includes("A Novel Approach"));
  });

  it("contains paper card summaries", () => {
    const html = renderDigest(date, [makeDigestSummary()]);
    assert.ok(html.includes("要約テキスト"));
  });

  it("contains paper card tags", () => {
    const html = renderDigest(date, [makeDigestSummary()]);
    assert.ok(html.includes("LLM"));
    assert.ok(html.includes("効率化"));
    assert.ok(html.includes('class="tag"'));
  });

  it("links paper cards to detail pages", () => {
    const html = renderDigest(date, [makeDigestSummary()]);
    assert.ok(html.includes("/papers/2501.00001.html"));
  });

  it("renders multiple paper cards", () => {
    const summaries = [
      makeDigestSummary({ arxiv_id: "2501.00001", title_ja: "論文A" }),
      makeDigestSummary({ arxiv_id: "2501.00002", title_ja: "論文B" }),
    ];
    const html = renderDigest(date, summaries);
    assert.ok(html.includes("論文A"));
    assert.ok(html.includes("論文B"));
    assert.ok(html.includes("/papers/2501.00001.html"));
    assert.ok(html.includes("/papers/2501.00002.html"));
  });

  it("renders empty list when no summaries", () => {
    const html = renderDigest(date, []);
    assert.ok(html.includes("0 件の論文"));
    assert.ok(!html.includes('class="card"'));
  });

  it("escapes HTML special characters in date", () => {
    const html = renderDigest('<script>"xss"</script>', []);
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("escapes HTML special characters in paper titles", () => {
    const summary = makeDigestSummary({
      title_ja: '<img onerror="alert(1)">',
    });
    const html = renderDigest(date, [summary]);
    assert.ok(!html.includes('<img onerror="alert(1)">'));
    assert.ok(html.includes("&lt;img onerror="));
  });
});
