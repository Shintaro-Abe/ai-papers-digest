'use strict';

(function () {
  var idx = null;
  var papers = null;
  var papersById = {};
  var input = document.getElementById('search-input');
  var resultsEl = document.getElementById('search-results');
  var statusEl = document.getElementById('search-status');

  statusEl.textContent = 'Loading search index...';

  fetch('/search-index.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      papers = data.papers;
      papers.forEach(function (p) { papersById[p.id] = p; });

      idx = lunr(function () {
        this.ref('id');
        this.field('title_ja', { boost: 2 });
        this.field('title', { boost: 1.5 });
        this.field('compact_summary');
        this.field('tags', { boost: 1.5 });
        var self = this;
        papers.forEach(function (p) { self.add(p); });
      });

      statusEl.textContent = papers.length + ' papers indexed.';
    })
    .catch(function (err) {
      statusEl.textContent = 'Failed to load search index.';
      console.error(err);
    });

  var debounceTimer = null;
  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 200);
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Substring match fallback for Japanese text.
   * lunr.js tokenizes on whitespace, so Japanese phrases without spaces
   * won't match via lunr. This provides a simple substring search.
   */
  function substringSearch(query) {
    if (!papers) return [];
    var q = query.toLowerCase();
    return papers.filter(function (p) {
      return (p.title_ja && p.title_ja.toLowerCase().indexOf(q) !== -1) ||
        (p.title && p.title.toLowerCase().indexOf(q) !== -1) ||
        (p.compact_summary && p.compact_summary.toLowerCase().indexOf(q) !== -1) ||
        (p.tags && p.tags.toLowerCase().indexOf(q) !== -1);
    });
  }

  function renderResults(matchedPapers) {
    if (matchedPapers.length === 0) {
      resultsEl.innerHTML = '<p class="no-similar">No results found.</p>';
      return;
    }

    var html = matchedPapers.slice(0, 30).map(function (p) {
      var tags = p.tags ? p.tags.split(' ').map(function (t) {
        return '<span class="tag">' + escapeHtml(t) + '</span>';
      }).join(' ') : '';

      return '<article class="card">' +
        '<h2 class="card-title"><a href="' + escapeHtml(p.url) + '">' + escapeHtml(p.title_ja) + '</a></h2>' +
        '<p class="card-original-title">' + escapeHtml(p.title) + '</p>' +
        '<p class="card-summary">' + escapeHtml(p.compact_summary) + '</p>' +
        '<div class="card-meta"><span class="card-date">' + escapeHtml(p.date) + '</span></div>' +
        '<div class="tags">' + tags + '</div>' +
        '</article>';
    }).join('');

    resultsEl.innerHTML = html;
  }

  function doSearch() {
    var query = input.value.trim();
    if (!papers) return;

    if (query.length < 2) {
      resultsEl.innerHTML = '';
      statusEl.textContent = papers.length + ' papers indexed.';
      return;
    }

    // Try lunr first (good for English and tokenized terms)
    var lunrResults = [];
    if (idx) {
      try {
        lunrResults = idx.search(query + '*');
      } catch (e) {
        try { lunrResults = idx.search(query); } catch (e2) { /* ignore */ }
      }
    }

    // Convert lunr results to paper objects
    var lunrPapers = lunrResults.map(function (r) { return papersById[r.ref]; }).filter(Boolean);

    // Fallback: substring search for Japanese text
    var subPapers = substringSearch(query);

    // Merge: lunr results first, then substring matches not already included
    var seen = {};
    var merged = [];
    lunrPapers.concat(subPapers).forEach(function (p) {
      if (!seen[p.id]) {
        seen[p.id] = true;
        merged.push(p);
      }
    });

    statusEl.textContent = merged.length + ' results found.';
    renderResults(merged);
  }
})();
