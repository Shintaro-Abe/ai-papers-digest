'use strict';

const { getPaper, putSummary, getSummariesByDate } = require('./dynamo-client');
const { generateSummary, emptyUsage, addUsage } = require('./claude-client');
const { compare } = require('./quality-judge');
const { renderDetail, renderDigest } = require('./html-generator');
const { upload } = require('./s3-uploader');
const { generateEmbedding } = require('./embedding-client');
const { putVector, getVector, querySimilar } = require('./vectors-client');
const {
  generate: generateDashboard,
  generateMonitoring,
  regenerateAllPapersAndDigests,
} = require('./dashboard-generator');
const { upsertRunStatus } = require('./pipeline-runs');

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main entry point.
 */
async function main() {
  const paperIdsRaw = process.env.PAPER_IDS;
  const targetDate = process.env.TARGET_DATE;

  if (!paperIdsRaw || !targetDate) {
    console.error('[summarizer] PAPER_IDS and TARGET_DATE env vars are required.');
    process.exit(1);
  }

  let paperIds;
  try {
    paperIds = JSON.parse(paperIdsRaw);
  } catch (err) {
    console.error(`[summarizer] Failed to parse PAPER_IDS: ${err.message}`);
    process.exit(1);
  }

  const vectorsEnabled = !!process.env.VECTOR_BUCKET;
  console.log(
    `[summarizer] Starting. Date: ${targetDate}, Papers: ${paperIds.length}, Vectors: ${vectorsEnabled}`
  );

  const processedSummaries = [];
  const embeddings = {}; // arxivId -> embedding
  const totalUsage = emptyUsage();
  const qualityResults = []; // { arxiv_id, winner, score }
  const errors = [];

  // ===== Phase 1: 要約生成 + 埋め込み + ベクトル保存 =====
  for (let i = 0; i < paperIds.length; i++) {
    const arxivId = paperIds[i];
    console.log(`[summarizer] Processing ${i + 1}/${paperIds.length}: ${arxivId}`);

    try {
      // 1. Fetch paper from DynamoDB
      const paper = await getPaper(arxivId);
      if (!paper) {
        console.warn(`[summarizer] Paper not found: ${arxivId}. Skipping.`);
        continue;
      }

      // 2. Generate summary with Claude
      console.log(`[summarizer] Generating summary for: ${paper.title}`);
      const { summary, usage: summaryUsage } = generateSummary(paper);
      addUsage(totalUsage, summaryUsage);

      // 3. Quality comparison if existing summary available
      let qualityResult = null;
      if (paper.hf_ai_summary) {
        console.log(`[summarizer] Comparing with existing HF AI summary...`);
        qualityResult = compare(summary, paper.hf_ai_summary);
        addUsage(totalUsage, qualityResult.usage);
        qualityResults.push({
          arxiv_id: arxivId,
          winner: qualityResult.winner,
          score: qualityResult.score,
        });
        console.log(
          `[summarizer] Quality judge: winner=${qualityResult.winner}, score=${qualityResult.score}`
        );
      }

      // 4. Store summary in DynamoDB (with quality fields if available)
      const stored = await putSummary(arxivId, summary, targetDate, qualityResult);
      console.log(`[summarizer] Summary stored for: ${arxivId}`);

      // 5. Generate embedding + store in S3 Vectors (Phase 3)
      if (vectorsEnabled) {
        try {
          const text = `${summary.title_original || paper.title} ${summary.compact_summary}`;
          console.log(`[summarizer] Generating embedding for: ${arxivId}`);
          const embedding = await generateEmbedding(text);
          embeddings[arxivId] = embedding;

          await putVector(arxivId, embedding, {
            title_ja: summary.title_ja,
            compact_summary: summary.compact_summary,
            tags: summary.tags,
            date: targetDate,
          });
          console.log(`[summarizer] Vector stored for: ${arxivId}`);
        } catch (err) {
          console.warn(`[summarizer] Embedding/vector failed for ${arxivId}: ${err.message}`);
          // Continue without vectors - not fatal
        }
      }

      // 6. Generate and upload detail HTML (without similar papers for now)
      const detailHtml = renderDetail(paper, summary);
      await upload(`papers/${arxivId}.html`, detailHtml);
      console.log(`[summarizer] Detail page uploaded for: ${arxivId}`);

      processedSummaries.push({ ...stored, arxiv_id: arxivId });

      // 7. Rate-limit pause between papers
      if (i < paperIds.length - 1) {
        console.log(`[summarizer] Sleeping 10s for rate limit...`);
        await sleep(10_000);
      }
    } catch (err) {
      console.error(`[summarizer] Error processing ${arxivId}: ${err.message}`);
      console.error(err.stack);
      errors.push({ arxiv_id: arxivId, message: err.message });
    }
  }

  // ===== Phase 3: 類似論文クエリ → 詳細ページ再生成 =====
  if (vectorsEnabled && Object.keys(embeddings).length > 0) {
    console.log(`[summarizer] Querying similar papers and regenerating detail pages...`);

    for (const arxivId of Object.keys(embeddings)) {
      try {
        const embedding = embeddings[arxivId];
        const similar = await querySimilar(embedding, 5, arxivId);

        if (similar.length > 0) {
          console.log(
            `[summarizer] Found ${similar.length} similar papers for ${arxivId}`
          );

          // Re-fetch paper and summary, re-render with similar papers
          const paper = await getPaper(arxivId);
          const summaryItem = processedSummaries.find((s) => s.arxiv_id === arxivId);
          if (paper && summaryItem) {
            const detailHtml = renderDetail(paper, summaryItem, similar);
            await upload(`papers/${arxivId}.html`, detailHtml);
            console.log(`[summarizer] Detail page re-uploaded with similar papers: ${arxivId}`);
          }
        }
      } catch (err) {
        console.warn(`[summarizer] Similar papers failed for ${arxivId}: ${err.message}`);
      }
    }
  }

  // ===== Daily digest =====
  try {
    console.log(`[summarizer] Generating daily digest for ${targetDate}...`);
    const allSummaries =
      processedSummaries.length > 0
        ? processedSummaries
        : await getSummariesByDate(targetDate);

    const digestHtml = renderDigest(targetDate, allSummaries);
    await upload(`digest/${targetDate}.html`, digestHtml);
    console.log(`[summarizer] Daily digest uploaded: digest/${targetDate}.html`);
  } catch (err) {
    console.error(`[summarizer] Failed to generate digest: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }

  // ===== Dashboard generation =====
  try {
    console.log(`[summarizer] Generating dashboard pages...`);
    await generateDashboard(targetDate);
  } catch (err) {
    console.error(`[summarizer] Failed to generate dashboard: ${err.message}`);
    console.error(err.stack);
    // Non-fatal: don't exit, just log
  }

  // ===== Monitoring dashboard =====
  try {
    await generateMonitoring(targetDate);
  } catch (err) {
    console.error(`[summarizer] Failed to generate monitoring dashboard: ${err.message}`);
    console.error(err.stack);
    // Non-fatal
  }

  // ===== Re-generate all historical paper / digest pages =====
  // Propagates template/style updates (e.g., nav changes) to existing pages.
  // Uses cached summaries; no LLM calls.
  try {
    console.log(`[summarizer] Re-generating all paper/digest pages...`);
    await regenerateAllPapersAndDigests();
  } catch (err) {
    console.error(`[summarizer] Failed to regenerate historical pages: ${err.message}`);
    console.error(err.stack);
    // Non-fatal
  }

  // ===== Pipeline-runs telemetry =====
  // Status reflects only fatal failures inside summarization; per-paper errors
  // surface as ``errors`` count but don't flip the pipeline to "error".
  try {
    const status = processedSummaries.length === 0 ? 'error' : 'success';
    const errorMessage =
      errors.length > 0 ? errors.map((e) => `${e.arxiv_id}: ${e.message}`).join('; ') : null;
    await upsertRunStatus(targetDate, 'summarizer', status, {
      error: errorMessage,
      extra: {
        papers_summarized: processedSummaries.length,
        papers_attempted: paperIds.length,
        claude_input_tokens: totalUsage.input_tokens,
        claude_output_tokens: totalUsage.output_tokens,
        claude_cache_read_tokens: totalUsage.cache_read_input_tokens,
        claude_cache_create_tokens: totalUsage.cache_creation_input_tokens,
        claude_cost_usd: Number(totalUsage.total_cost_usd.toFixed(6)),
        quality_results: qualityResults,
      },
    });
  } catch (err) {
    console.warn(`[summarizer] pipeline-runs upsert failed: ${err.message}`);
  }

  console.log(
    `[summarizer] Complete. Processed ${processedSummaries.length}/${paperIds.length} papers. ` +
      `tokens=in:${totalUsage.input_tokens}/out:${totalUsage.output_tokens} ` +
      `cost=$${totalUsage.total_cost_usd.toFixed(4)}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`[summarizer] Fatal error: ${err.message}`);
  console.error(err.stack);
  // Best-effort failure telemetry — never block on this.
  const targetDate = process.env.TARGET_DATE;
  if (targetDate) {
    upsertRunStatus(targetDate, 'summarizer', 'error', { error: err.message }).catch(() => {});
  }
  process.exit(1);
});
