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
    const stderr = err.stderr ? err.stderr.toString() : "no stderr";
    const stdout = err.stdout ? err.stdout.toString().slice(0, 500) : "no stdout";
    throw new Error(`Claude CLI failed. stderr: ${stderr} | stdout: ${stdout}`);
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
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  // If text is already an object with expected fields, return it
  if (typeof parsed === "object" && parsed.compact_summary) {
    return parsed;
  }

  throw new Error("Failed to extract JSON from Claude response");
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
 */
function generateSummary(paper) {
  const prompt = buildPrompt(paper);

  let summary = callClaude(prompt);

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

    summary = callClaude(retryPrompt);

    if (!isValidSummaryLength(summary)) {
      console.warn(
        `[claude-client] Retry still produced ${summary.compact_summary ? summary.compact_summary.length : 0} chars. Proceeding anyway.`
      );
    }
  }

  return summary;
}

module.exports = { generateSummary };
