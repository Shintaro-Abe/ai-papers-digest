"use strict";

const fs = require("fs");
const path = require("path");

const TEMPLATES_DIR = path.resolve(__dirname, "../templates");

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Render a paper detail page.
 */
function renderDetail(paper, summary) {
  const template = fs.readFileSync(
    path.join(TEMPLATES_DIR, "paper-detail.html"),
    "utf-8"
  );

  const authors = Array.isArray(paper.authors)
    ? paper.authors.join(", ")
    : paper.authors || "";
  const categories = Array.isArray(paper.categories)
    ? paper.categories.join(", ")
    : paper.categories || "";
  const tags = Array.isArray(summary.tags) ? summary.tags : [];
  const tagsHtml = tags
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("\n            ");

  const arxivUrl = `https://arxiv.org/abs/${paper.arxiv_id}`;
  const githubUrl = paper.github_url || "";
  const githubLinkHtml = githubUrl
    ? `<a href="${escapeHtml(githubUrl)}" class="btn btn-secondary" target="_blank" rel="noopener">GitHub</a>`
    : "";

  return template
    .replace(/\{\{title_original\}\}/g, escapeHtml(summary.title_original || paper.title))
    .replace(/\{\{title_ja\}\}/g, escapeHtml(summary.title_ja))
    .replace(/\{\{authors\}\}/g, escapeHtml(authors))
    .replace(/\{\{date\}\}/g, escapeHtml(paper.published_at || paper.date || ""))
    .replace(/\{\{categories\}\}/g, escapeHtml(categories))
    .replace(/\{\{upvotes\}\}/g, escapeHtml(String(paper.upvotes || 0)))
    .replace(/\{\{citations\}\}/g, escapeHtml(String(paper.num_citations || 0)))
    .replace(/\{\{score\}\}/g, escapeHtml(String(paper.score || 0)))
    .replace(/\{\{compact_summary\}\}/g, escapeHtml(summary.compact_summary))
    .replace(/\{\{detail_novelty\}\}/g, escapeHtml(summary.detail?.novelty || summary.detail_novelty || ""))
    .replace(/\{\{detail_method\}\}/g, escapeHtml(summary.detail?.method || summary.detail_method || ""))
    .replace(/\{\{detail_results\}\}/g, escapeHtml(summary.detail?.results || summary.detail_results || ""))
    .replace(/\{\{detail_practicality\}\}/g, escapeHtml(summary.detail?.practicality || summary.detail_practicality || ""))
    .replace(/\{\{tags\}\}/g, tagsHtml)
    .replace(/\{\{arxiv_url\}\}/g, escapeHtml(arxivUrl))
    .replace(/\{\{github_link\}\}/g, githubLinkHtml);
}

/**
 * Render the daily digest page.
 */
function renderDigest(date, summaries) {
  const template = fs.readFileSync(
    path.join(TEMPLATES_DIR, "daily-digest.html"),
    "utf-8"
  );

  const paperCards = summaries
    .map((s) => {
      const tags = Array.isArray(s.tags) ? s.tags : [];
      const tagsHtml = tags
        .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
        .join("\n              ");

      return `        <article class="card">
          <h2 class="card-title">
            <a href="/papers/${escapeHtml(s.arxiv_id)}.html">${escapeHtml(s.title_ja)}</a>
          </h2>
          <p class="card-original-title">${escapeHtml(s.title_original)}</p>
          <p class="card-summary">${escapeHtml(s.compact_summary)}</p>
          <div class="tags">
            ${tagsHtml}
          </div>
        </article>`;
    })
    .join("\n");

  return template
    .replace(/\{\{date\}\}/g, escapeHtml(date))
    .replace(/\{\{paper_count\}\}/g, String(summaries.length))
    .replace(/\{\{paper_cards\}\}/g, paperCards);
}

module.exports = { renderDetail, renderDigest, escapeHtml };
