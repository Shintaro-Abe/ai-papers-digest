"use strict";

const { getPaper, putSummary, getSummariesByDate } = require("./dynamo-client");
const { generateSummary } = require("./claude-client");
const { compare } = require("./quality-judge");
const { renderDetail, renderDigest } = require("./html-generator");
const { upload } = require("./s3-uploader");

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
    console.error("[summarizer] PAPER_IDS and TARGET_DATE env vars are required.");
    process.exit(1);
  }

  let paperIds;
  try {
    paperIds = JSON.parse(paperIdsRaw);
  } catch (err) {
    console.error(`[summarizer] Failed to parse PAPER_IDS: ${err.message}`);
    process.exit(1);
  }

  console.log(`[summarizer] Starting. Date: ${targetDate}, Papers: ${paperIds.length}`);

  const processedSummaries = [];

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
        console.log(`[summarizer] Quality judge: winner=${result.winner}, score=${result.score}`);
      }

      // 4. Store summary in DynamoDB
      const stored = await putSummary(arxivId, summary, targetDate);
      console.log(`[summarizer] Summary stored for: ${arxivId}`);

      // 5. Generate and upload detail HTML
      const detailHtml = renderDetail(paper, summary);
      await upload(`papers/${arxivId}.html`, detailHtml);
      console.log(`[summarizer] Detail page uploaded for: ${arxivId}`);

      processedSummaries.push({ ...stored, arxiv_id: arxivId });

      // 6. Rate-limit pause between papers
      if (i < paperIds.length - 1) {
        console.log(`[summarizer] Sleeping 10s for rate limit...`);
        await sleep(10_000);
      }
    } catch (err) {
      console.error(`[summarizer] Error processing ${arxivId}: ${err.message}`);
      console.error(err.stack);
      // Continue with next paper instead of failing completely
    }
  }

  // Generate and upload daily digest
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
