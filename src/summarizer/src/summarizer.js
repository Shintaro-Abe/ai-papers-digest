'use strict';

const { getPaper, putSummary, getSummariesByDate } = require('./dynamo-client');
const { generateSummary } = require('./claude-client');
const { compare } = require('./quality-judge');
const { renderDetail, renderDigest } = require('./html-generator');
const { upload } = require('./s3-uploader');
const { generateEmbedding } = require('./embedding-client');
const { putVector, getVector, querySimilar } = require('./vectors-client');

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
      const summary = generateSummary(paper);

      // 3. Quality comparison if existing summary available
      if (paper.hf_ai_summary) {
        console.log(`[summarizer] Comparing with existing HF AI summary...`);
        const result = compare(summary, paper.hf_ai_summary);
        console.log(
          `[summarizer] Quality judge: winner=${result.winner}, score=${result.score}`
        );
      }

      // 4. Store summary in DynamoDB
      const stored = await putSummary(arxivId, summary, targetDate);
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

  console.log(
    `[summarizer] Complete. Processed ${processedSummaries.length}/${paperIds.length} papers.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`[summarizer] Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
