"use strict";

const { query } = require("@anthropic-ai/claude-agent-sdk");
const { emptyUsage } = require("./claude-client");

const MODEL = process.env.CLAUDE_MODEL || "sonnet";

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
async function compare(generatedSummary, hfAiSummary) {
  const usage = emptyUsage();
  try {
    const prompt = COMPARE_PROMPT_TEMPLATE
      .replace("{{generated_summary}}", generatedSummary.compact_summary || "")
      .replace("{{existing_summary}}", hfAiSummary || "");

    let resultMsg = null;
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

    if (!resultMsg || resultMsg.is_error) {
      throw new Error(resultMsg ? String(resultMsg.result || "").slice(0, 200) : "no result message");
    }

    const text = typeof resultMsg.result === "string" ? resultMsg.result : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const evaluation = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    const winner = evaluation.winner === "B" ? "hf" : "claude";
    const score = Number(evaluation.score) || 7;

    const sdkUsage = resultMsg.usage || {};
    usage.input_tokens = Number(sdkUsage.input_tokens ?? 0) || 0;
    usage.output_tokens = Number(sdkUsage.output_tokens ?? 0) || 0;
    usage.cache_creation_input_tokens = Number(sdkUsage.cache_creation_input_tokens ?? 0) || 0;
    usage.cache_read_input_tokens = Number(sdkUsage.cache_read_input_tokens ?? 0) || 0;
    usage.total_cost_usd = Number(resultMsg.total_cost_usd ?? 0) || 0;

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
