"use strict";

const { execSync } = require("child_process");

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
 * Run claude CLI and parse JSON output.
 *
 * Returns ``{ data, usage }`` where ``usage`` carries token counts and cost
 * lifted from the CLI's top-level JSON envelope (``input_tokens`` /
 * ``output_tokens`` / ``total_cost_usd``). Caller may ignore ``usage``.
 */
function callClaude(prompt) {
  let result;
  try {
    result = execSync("claude -p --output-format json --max-turns 1", {
      input: prompt,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().slice(0, 200) : "no stderr";
    const stdout = err.stdout ? err.stdout.toString() : "";
    // Extract only safe fields from Claude CLI JSON output (avoid leaking tokens/session data)
    let safeMessage = "no details";
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.is_error) {
        safeMessage = (parsed.result || "").slice(0, 200);
      }
    } catch {
      safeMessage = stdout.slice(0, 100);
    }
    throw new Error(`Claude CLI failed. stderr: ${stderr} | detail: ${safeMessage}`);
  }

  const parsed = JSON.parse(result);

  // The claude CLI with --output-format json wraps the response.
  // Extract the text content.
  const text =
    typeof parsed === "string"
      ? parsed
      : parsed.result || parsed.content || parsed.text || JSON.stringify(parsed);

  // Try to extract JSON from the text
  const jsonMatch =
    typeof text === "string" ? text.match(/\{[\s\S]*\}/) : null;
  let data;
  if (jsonMatch) {
    data = JSON.parse(jsonMatch[0]);
  } else if (typeof parsed === "object" && parsed.compact_summary) {
    data = parsed;
  } else {
    throw new Error("Failed to extract JSON from Claude response");
  }

  return { data, usage: extractUsage(parsed) };
}

/**
 * Pull usage / cost out of the Claude CLI envelope.
 * Different versions surface fields slightly differently; tolerate missing keys.
 */
function extractUsage(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const usage = parsed.usage || {};
  const inputTokens =
    Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const outputTokens =
    Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const cacheCreate = Number(usage.cache_creation_input_tokens ?? 0) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0) || 0;
  const totalCostUsd =
    Number(parsed.total_cost_usd ?? parsed.cost_usd ?? 0) || 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: cacheCreate,
    cache_read_input_tokens: cacheRead,
    total_cost_usd: totalCostUsd,
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
 * Generate a summary for a paper using Claude CLI.
 * Retries once if compact_summary length is out of range.
 *
 * Returns ``{ summary, usage }``; ``usage`` aggregates token / cost across
 * the initial call and any retry.
 */
function generateSummary(paper) {
  const prompt = buildPrompt(paper);
  const usage = emptyUsage();

  let { data: summary, usage: firstUsage } = callClaude(prompt);
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

    const retried = callClaude(retryPrompt);
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
