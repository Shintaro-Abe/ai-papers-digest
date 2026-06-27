"use strict";

const { query } = require("@anthropic-ai/claude-agent-sdk");

// Pin the model explicitly: without it the SDK defaults to haiku, which is too
// weak for paper summarization. Overridable via env for prod tuning.
const MODEL = process.env.CLAUDE_MODEL || "sonnet";

const SUMMARY_PROMPT_TEMPLATE = `あなたはAI/機械学習分野の論文要約エキスパートです。
以下のarXiv論文情報を読み、AIエンジニア向けに日本語で要約してください。

## 論文情報
- タイトル: {{title}}
- 著者: {{authors}}
- カテゴリ: {{categories}}
- アブストラクト: {{abstract}}

## 出力形式
以下のJSON形式で出力してください。JSON以外のテキストは含めないでください。

{
  "title_original": "原題をそのまま記載",
  "title_ja": "日本語に翻訳したタイトル",
  "compact_summary": "200〜400文字の日本語要約。論文の核心的な貢献と結果を簡潔に記述。AIエンジニアが一目で内容を把握できるように書く。",
  "detail": {
    "novelty": "この論文の新規性・独自性を2〜3文で説明",
    "method": "提案手法・アプローチを2〜3文で説明",
    "results": "主要な実験結果・性能指標を2〜3文で説明",
    "practicality": "実務への応用可能性・インパクトを2〜3文で説明"
  },
  "tags": ["関連タグを3〜5個。例: LLM, 画像生成, 強化学習, Transformer, 効率化"]
}

重要な制約:
- compact_summaryは必ず200文字以上400文字以下にしてください
- 日本語で記述してください
- JSONのみを出力してください`;

/**
 * Build the prompt for a given paper.
 */
function buildPrompt(paper) {
  const authors = Array.isArray(paper.authors)
    ? paper.authors.join(", ")
    : paper.authors || "N/A";
  const categories = Array.isArray(paper.categories)
    ? paper.categories.join(", ")
    : paper.categories || "N/A";

  return SUMMARY_PROMPT_TEMPLATE
    .replace("{{title}}", paper.title || "N/A")
    .replace("{{authors}}", authors)
    .replace("{{categories}}", categories)
    .replace("{{abstract}}", paper.abstract || "N/A");
}

/**
 * Run a single-shot Agent SDK query and parse JSON output.
 *
 * Returns ``{ data, usage }`` where ``usage`` carries token counts and cost
 * lifted from the SDK result message (``input_tokens`` / ``output_tokens`` /
 * ``total_cost_usd``). Caller may ignore ``usage``.
 *
 * Authentication is supplied out-of-band via the Claude subscription
 * (``CLAUDE_CODE_OAUTH_TOKEN`` env in prod, ``~/.claude/.credentials.json``
 * locally) — no API key. ``allowedTools: []`` + ``maxTurns: 1`` make this a
 * pure, non-interactive text generation with no tool/file/shell access.
 */
async function callClaude(prompt) {
  let resultMsg = null;
  try {
    for await (const message of query({
      prompt,
      options: {
        model: MODEL,
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "dontAsk",
      },
    })) {
      if (message.type === "result") resultMsg = message;
    }
  } catch (err) {
    const detail = err && err.message ? String(err.message).slice(0, 200) : "no details";
    throw new Error(`Agent SDK query failed: ${detail}`);
  }

  if (!resultMsg || resultMsg.is_error) {
    const detail = resultMsg ? String(resultMsg.result || "").slice(0, 200) : "no result message";
    throw new Error(`Agent SDK returned error: ${detail}`);
  }

  const text = typeof resultMsg.result === "string" ? resultMsg.result : "";
  // The model is instructed to emit JSON only; tolerate stray prose by
  // extracting the first {...} block.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from Agent SDK response");
  }
  const data = JSON.parse(jsonMatch[0]);

  return { data, usage: extractUsage(resultMsg) };
}

/**
 * Pull usage / cost out of the Agent SDK result message.
 * Tolerate missing keys across SDK versions.
 */
function extractUsage(resultMsg) {
  if (!resultMsg || typeof resultMsg !== "object") return null;
  const usage = resultMsg.usage || {};
  return {
    input_tokens: Number(usage.input_tokens ?? 0) || 0,
    output_tokens: Number(usage.output_tokens ?? 0) || 0,
    cache_creation_input_tokens: Number(usage.cache_creation_input_tokens ?? 0) || 0,
    cache_read_input_tokens: Number(usage.cache_read_input_tokens ?? 0) || 0,
    total_cost_usd: Number(resultMsg.total_cost_usd ?? 0) || 0,
  };
}

function emptyUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    total_cost_usd: 0,
  };
}

function addUsage(target, addition) {
  if (!addition) return target;
  for (const key of Object.keys(target)) {
    target[key] += Number(addition[key] || 0);
  }
  return target;
}

/**
 * Validate that compact_summary length is 200-400 characters.
 */
function isValidSummaryLength(summary) {
  if (!summary || !summary.compact_summary) return false;
  const len = summary.compact_summary.length;
  return len >= 200 && len <= 400;
}

/**
 * Generate a summary for a paper using the Claude Agent SDK.
 * Retries once if compact_summary length is out of range.
 *
 * Returns ``{ summary, usage }``; ``usage`` aggregates token / cost across
 * the initial call and any retry.
 */
async function generateSummary(paper) {
  const prompt = buildPrompt(paper);
  const usage = emptyUsage();

  let { data: summary, usage: firstUsage } = await callClaude(prompt);
  addUsage(usage, firstUsage);

  if (!isValidSummaryLength(summary)) {
    const currentLen = summary.compact_summary
      ? summary.compact_summary.length
      : 0;
    console.log(
      `[claude-client] compact_summary length ${currentLen} out of range (200-400). Retrying...`
    );

    const retryPrompt =
      prompt +
      `\n\n前回の出力ではcompact_summaryが${currentLen}文字でした。必ず200〜400文字の範囲に収めてください。`;

    const retried = await callClaude(retryPrompt);
    summary = retried.data;
    addUsage(usage, retried.usage);

    if (!isValidSummaryLength(summary)) {
      console.warn(
        `[claude-client] Retry still produced ${summary.compact_summary ? summary.compact_summary.length : 0} chars. Proceeding anyway.`
      );
    }
  }

  return { summary, usage };
}

module.exports = { generateSummary, emptyUsage, addUsage };
