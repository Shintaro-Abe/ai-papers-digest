"use strict";

// Unit tests for the Agent SDK migration of claude-client / quality-judge.
//
// The clients `require("@anthropic-ai/claude-agent-sdk")` at module load. We
// intercept that require via Module._load and inject a fake `query()` so the
// tests run without the real SDK installed and without any network/auth.
//
// NOTE: CI runs only `pytest tests/unit/` — these node:test files are local /
// PR confidence, not a deploy safety net.

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

// --- SDK mock plumbing ---------------------------------------------------
let queuedResults = []; // FIFO of result-message objects to yield, one per query() call
let queryCalls = 0;

function makeResultMessage({ result, usage, total_cost_usd = 0, is_error = false }) {
  return {
    type: "result",
    subtype: is_error ? "error_during_execution" : "success",
    is_error,
    result,
    usage: usage || {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 0,
    },
    total_cost_usd,
  };
}

// Fake query(): returns an async iterable yielding an assistant-ish message
// then the next queued result message.
function fakeQuery() {
  queryCalls += 1;
  const resultMsg = queuedResults.shift();
  return (async function* () {
    yield { type: "assistant", message: { content: [] } };
    yield resultMsg;
  })();
}

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@anthropic-ai/claude-agent-sdk") {
    return { query: fakeQuery };
  }
  return origLoad.apply(this, arguments);
};

// Require AFTER the interceptor is installed.
const { generateSummary, emptyUsage } = require("../../../src/summarizer/src/claude-client");
const { compare } = require("../../../src/summarizer/src/quality-judge");

// Restore on process exit (best-effort; node:test runs in one process here).
process.on("exit", () => {
  Module._load = origLoad;
});

function validSummaryJson(len) {
  const body = "あ".repeat(len);
  return JSON.stringify({
    title_original: "Orig",
    title_ja: "原題",
    compact_summary: body,
    detail: { novelty: "n", method: "m", results: "r", practicality: "p" },
    tags: ["LLM", "効率化"],
  });
}

beforeEach(() => {
  queuedResults = [];
  queryCalls = 0;
});

describe("claude-client (Agent SDK) generateSummary", () => {
  it("parses JSON from result.result and maps usage", async () => {
    queuedResults.push(
      makeResultMessage({
        result: "余計な前置き " + validSummaryJson(300),
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 10,
        },
        total_cost_usd: 0.12,
      })
    );

    const paper = { title: "T", authors: ["A"], categories: ["cs.AI"], abstract: "abs" };
    const { summary, usage } = await generateSummary(paper);

    assert.equal(queryCalls, 1, "single SDK call when summary length is valid");
    assert.equal(summary.compact_summary.length, 300);
    assert.deepEqual(summary.tags, ["LLM", "効率化"]);
    assert.equal(usage.input_tokens, 100);
    assert.equal(usage.output_tokens, 50);
    assert.equal(usage.cache_creation_input_tokens, 30);
    assert.equal(usage.cache_read_input_tokens, 10);
    assert.equal(usage.total_cost_usd, 0.12);
  });

  it("retries once when compact_summary length is out of range and aggregates usage", async () => {
    // First: too short (50). Second: valid (250).
    queuedResults.push(
      makeResultMessage({ result: validSummaryJson(50), total_cost_usd: 0.01 })
    );
    queuedResults.push(
      makeResultMessage({ result: validSummaryJson(250), total_cost_usd: 0.02 })
    );

    const paper = { title: "T", authors: ["A"], categories: ["cs.AI"], abstract: "abs" };
    const { summary, usage } = await generateSummary(paper);

    assert.equal(queryCalls, 2, "retried once");
    assert.equal(summary.compact_summary.length, 250);
    // usage aggregated across both calls (default usage 10/20/5/0 each) + costs summed
    assert.equal(usage.total_cost_usd, 0.03);
    assert.equal(usage.input_tokens, 20);
    assert.equal(usage.output_tokens, 40);
  });

  it("throws when no JSON block is present", async () => {
    queuedResults.push(makeResultMessage({ result: "no json here" }));
    const paper = { title: "T", authors: ["A"], categories: ["cs.AI"], abstract: "abs" };
    await assert.rejects(() => generateSummary(paper), /extract JSON/);
  });
});

describe("quality-judge (Agent SDK) compare", () => {
  it("maps winner B -> hf and lifts usage", async () => {
    queuedResults.push(
      makeResultMessage({
        result: JSON.stringify({ winner: "B", score: 9, reason: "既存が網羅的" }),
        usage: {
          input_tokens: 7,
          output_tokens: 3,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        total_cost_usd: 0.005,
      })
    );
    const res = await compare({ compact_summary: "gen" }, "existing");
    assert.equal(res.winner, "hf");
    assert.equal(res.score, 9);
    assert.equal(res.usage.input_tokens, 7);
    assert.equal(res.usage.total_cost_usd, 0.005);
  });

  it("defaults to winner=claude on SDK error without throwing", async () => {
    queuedResults.push(makeResultMessage({ result: "boom", is_error: true }));
    const res = await compare({ compact_summary: "gen" }, "existing");
    assert.equal(res.winner, "claude");
    assert.equal(res.score, 7);
    // usage stays zeroed
    assert.deepEqual(res.usage, emptyUsage());
  });
});
