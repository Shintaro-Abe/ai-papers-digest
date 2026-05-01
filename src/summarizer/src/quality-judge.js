"use strict";

const { execSync } = require("child_process");
const { emptyUsage } = require("./claude-client");

const COMPARE_PROMPT_TEMPLATE = `あなたはAI論文要約の品質評価者です。
以下の2つの要約を比較し、AIエンジニアにとってどちらがより有用かを判定してください。

## 要約A（自動生成）
{{generated_summary}}

## 要約B（既存要約）
{{existing_summary}}

## 評価基準
1. 技術的正確性
2. 情報の網羅性
3. 簡潔さと読みやすさ
4. AIエンジニアへの実用性

以下のJSON形式のみを出力してください:
{
  "winner": "A" または "B",
  "score": 1〜10の整数（勝者の品質スコア）,
  "reason": "判定理由を1文で"
}`;

/**
 * Compare a generated summary with an existing HF AI summary.
 * Returns ``{ winner, score, reason, usage }``.
 *   - winner: ``"claude"`` (auto-generated) or ``"hf"`` (existing)
 *   - score: integer (1-10), the winner's quality
 *   - usage: token / cost figures for the judge call (or zeros on failure)
 */
function compare(generatedSummary, hfAiSummary) {
  const usage = emptyUsage();
  try {
    const prompt = COMPARE_PROMPT_TEMPLATE
      .replace("{{generated_summary}}", generatedSummary.compact_summary || "")
      .replace("{{existing_summary}}", hfAiSummary || "");

    const result = execSync("claude -p --output-format json --max-turns 1", {
      input: prompt,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });

    const parsed = JSON.parse(result);
    const text =
      typeof parsed === "string"
        ? parsed
        : parsed.result || parsed.content || parsed.text || JSON.stringify(parsed);

    const jsonMatch =
      typeof text === "string" ? text.match(/\{[\s\S]*\}/) : null;
    const evaluation = jsonMatch ? JSON.parse(jsonMatch[0]) : parsed;

    const winner = evaluation.winner === "B" ? "hf" : "claude";
    const score = Number(evaluation.score) || 7;

    if (parsed && typeof parsed === "object") {
      const cliUsage = parsed.usage || {};
      usage.input_tokens =
        Number(cliUsage.input_tokens ?? cliUsage.prompt_tokens ?? 0) || 0;
      usage.output_tokens =
        Number(cliUsage.output_tokens ?? cliUsage.completion_tokens ?? 0) || 0;
      usage.cache_creation_input_tokens =
        Number(cliUsage.cache_creation_input_tokens ?? 0) || 0;
      usage.cache_read_input_tokens =
        Number(cliUsage.cache_read_input_tokens ?? 0) || 0;
      usage.total_cost_usd =
        Number(parsed.total_cost_usd ?? parsed.cost_usd ?? 0) || 0;
    }

    console.log(
      `[quality-judge] Winner: ${winner}, Score: ${score}, Reason: ${evaluation.reason || "N/A"}`
    );

    return { winner, score, reason: evaluation.reason || null, usage };
  } catch (err) {
    console.warn(`[quality-judge] Comparison failed: ${err.message}. Defaulting to claude.`);
    return { winner: "claude", score: 7, reason: null, usage };
  }
}

module.exports = { compare };
