'use strict';

(function () {
  const dataNode = document.getElementById('dashboard-data');
  if (!dataNode) return;

  let payload;
  try {
    payload = JSON.parse(dataNode.textContent || '{}');
  } catch (err) {
    console.error('[dashboard] failed to parse data', err);
    return;
  }
  const charts = (payload && payload.charts) || {};

  const PALETTE = {
    primary: '#1a73e8',
    primaryLight: '#8ab4f8',
    success: '#0d652d',
    successLight: '#a3d9b1',
    warn: '#f9ab00',
    danger: '#c5221f',
    grayDark: '#5f6368',
    grayLight: '#dadce0',
  };

  function showEmpty(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.style.display = 'none';
    const note = document.createElement('p');
    note.className = 'chart-empty';
    note.textContent = message || 'データがまだありません';
    note.style.color = PALETTE.grayDark;
    note.style.fontSize = '0.875rem';
    note.style.padding = '2rem 0';
    note.style.textAlign = 'center';
    parent.appendChild(note);
  }

  function makeChart(canvasId, config, hasData) {
    if (!hasData) {
      showEmpty(canvasId);
      return null;
    }
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    if (typeof window.Chart === 'undefined') {
      showEmpty(canvasId, 'Chart.js が読み込めませんでした');
      return null;
    }
    return new window.Chart(canvas.getContext('2d'), config);
  }

  // 1. Collection volume (line)
  (function renderCollection() {
    const c = charts.collection;
    const hasData = c && Array.isArray(c.labels) && c.labels.length > 0;
    makeChart('chart-collection', {
      type: 'line',
      data: {
        labels: hasData ? c.labels : [],
        datasets: hasData
          ? [
              { label: 'HF', data: c.hf || [], borderColor: PALETTE.primary, backgroundColor: PALETTE.primary, tension: 0.3 },
              { label: 'arXiv', data: c.arxiv || [], borderColor: PALETTE.success, backgroundColor: PALETTE.success, tension: 0.3 },
            ]
          : [],
      },
      options: { responsive: true, maintainAspectRatio: false },
    }, hasData);
  })();

  // 2. Score breakdown — latest selected papers (合計スコア棒、tooltip でメタ表示)
  (function renderScoreBreakdown() {
    const sb = charts.scoreBreakdown;
    const hasData = sb && Array.isArray(sb.papers) && sb.papers.length > 0;
    if (!hasData) { showEmpty('chart-score-breakdown'); return; }
    const labels = sb.papers.map((p) => p.arxivId || '');
    const data = sb.papers.map((p) => p.score || 0);
    const w = sb.weights || {};
    const subtitle = `重み w1=${(w.w1 ?? 0).toFixed(2)} / w2=${(w.w2 ?? 0).toFixed(2)} / w3=${(w.w3 ?? 0).toFixed(2)} / w4=${(w.w4 ?? 0).toFixed(2)}`;
    makeChart('chart-score-breakdown', {
      type: 'bar',
      data: { labels, datasets: [{ label: '合計スコア', data, backgroundColor: PALETTE.primary }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } },
        plugins: {
          subtitle: { display: true, text: subtitle },
          tooltip: {
            callbacks: {
              afterLabel: (ctx) => {
                const p = sb.papers[ctx.dataIndex] || {};
                const lines = [];
                if (p.titleJa) lines.push(p.titleJa);
                if (typeof p.hfUpvotes === 'number') lines.push(`HF upvotes: ${p.hfUpvotes}`);
                if (typeof p.sourceCount === 'number') lines.push(`sources: ${p.sourceCount}`);
                return lines;
              },
            },
          },
        },
      },
    }, true);
  })();

  // 3. Feedback distribution (grouped bar by tag)
  (function renderFeedback() {
    const f = charts.feedback;
    const hasData = f && Array.isArray(f.labels) && f.labels.length > 0;
    makeChart('chart-feedback', {
      type: 'bar',
      data: {
        labels: hasData ? f.labels : [],
        datasets: hasData
          ? [
              { label: '👍 like', data: f.like || [], backgroundColor: PALETTE.success },
              { label: '👎 dislike', data: f.dislike || [], backgroundColor: PALETTE.danger },
            ]
          : [],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
    }, hasData);
  })();

  // 4. Weights history (line)
  (function renderWeights() {
    const w = charts.weights;
    const hasData = w && Array.isArray(w.labels) && w.labels.length > 0 && Array.isArray(w.datasets) && w.datasets.length > 0;
    if (!hasData) { showEmpty('chart-weights'); return; }
    const colorByKey = { w1: PALETTE.primary, w2: PALETTE.success, w3: PALETTE.warn, w4: PALETTE.danger };
    const datasets = w.datasets.map((d) => ({
      label: d.label,
      data: d.data,
      borderColor: colorByKey[d.key] || PALETTE.grayDark,
      backgroundColor: colorByKey[d.key] || PALETTE.grayDark,
      tension: 0.3,
    }));
    makeChart('chart-weights', {
      type: 'line',
      data: { labels: w.labels, datasets },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 1 } } },
    }, true);
  })();

  // 5. Pipeline health (heatmap-ish stacked bars)
  (function renderHealth() {
    const h = charts.pipelineHealth;
    const hasData = h && Array.isArray(h.labels) && h.labels.length > 0 && Array.isArray(h.stages);
    if (!hasData) { showEmpty('chart-pipeline-health'); return; }
    const datasets = h.stages.map((s) => ({
      label: s.label,
      data: s.data.map((v) => (v === null || v === undefined ? 0 : 1)),
      backgroundColor: s.data.map((v) => {
        if (v === 1) return PALETTE.success;
        if (v === 0) return PALETTE.danger;
        return PALETTE.grayLight;
      }),
    }));
    makeChart('chart-pipeline-health', {
      type: 'bar',
      data: { labels: h.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, max: h.stages.length } },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const stage = h.stages[ctx.datasetIndex];
                const raw = stage && stage.data ? stage.data[ctx.dataIndex] : null;
                const status = raw === 1 ? 'success' : raw === 0 ? 'error' : 'missing';
                return `${stage.label}: ${status}`;
              },
            },
          },
        },
      },
    }, true);
  })();

  // 6. Cost + tokens (mixed)
  (function renderCost() {
    const c = charts.cost;
    const hasData = c && Array.isArray(c.labels) && c.labels.length > 0;
    makeChart('chart-cost', {
      data: {
        labels: hasData ? c.labels : [],
        datasets: hasData
          ? [
              { type: 'line', label: 'コスト USD', data: c.costUsd || [], borderColor: PALETTE.danger, backgroundColor: PALETTE.danger, yAxisID: 'y', tension: 0.3 },
              { type: 'bar', label: 'input tokens', data: c.inputTokens || [], backgroundColor: PALETTE.primary, yAxisID: 'y1' },
              { type: 'bar', label: 'output tokens', data: c.outputTokens || [], backgroundColor: PALETTE.primaryLight, yAxisID: 'y1' },
            ]
          : [],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: 'USD' } },
          y1: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'tokens' }, grid: { drawOnChartArea: false } },
        },
      },
    }, hasData);
  })();

  // 7. Delivery (bar)
  (function renderDelivery() {
    const d = charts.delivery;
    const hasData = d && Array.isArray(d.labels) && d.labels.length > 0;
    makeChart('chart-delivery', {
      type: 'bar',
      data: {
        labels: hasData ? d.labels : [],
        datasets: hasData ? [{ label: '配信件数', data: d.delivered || [], backgroundColor: PALETTE.primary }] : [],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
    }, hasData);
  })();

  // 8. Learning loop (mixed: skipped flag bar)
  (function renderLearningLoop() {
    const l = charts.learningLoop;
    const hasData = l && Array.isArray(l.history) && l.history.length > 0;
    if (!hasData) { showEmpty('chart-learning-loop'); return; }
    const labels = l.history.map((h) => h.date);
    const skipped = l.history.map((h) => (h.skipped ? 1 : 0));
    const ran = l.history.map((h) => (h.skipped ? 0 : 1));
    makeChart('chart-learning-loop', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '実行', data: ran, backgroundColor: PALETTE.success, stack: 'run' },
          { label: 'スキップ', data: skipped, backgroundColor: PALETTE.warn, stack: 'run' },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, max: 1 } } },
    }, true);
  })();

  // 9. Diversity (donut: HF vs arXiv-only + categories aside)
  (function renderDiversity() {
    const d = charts.diversity;
    const hasData = d && (typeof d.hfCount === 'number' || (d.categories && Object.keys(d.categories).length > 0));
    if (!hasData) { showEmpty('chart-diversity'); return; }
    const catEntries = Object.entries(d.categories || {}).slice(0, 8);
    const hasCategoryData = catEntries.length > 0;
    if (hasCategoryData) {
      makeChart('chart-diversity', {
        type: 'doughnut',
        data: {
          labels: catEntries.map(([k]) => k),
          datasets: [{ data: catEntries.map(([, v]) => v), backgroundColor: [PALETTE.primary, PALETTE.success, PALETTE.warn, PALETTE.danger, PALETTE.primaryLight, PALETTE.successLight, PALETTE.grayDark, PALETTE.grayLight] }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
      }, true);
    } else {
      makeChart('chart-diversity', {
        type: 'doughnut',
        data: {
          labels: ['HF人気', 'arXiv のみ'],
          datasets: [{ data: [d.hfCount || 0, d.arxivOnlyCount || 0], backgroundColor: [PALETTE.primary, PALETTE.success] }],
        },
        options: { responsive: true, maintainAspectRatio: false },
      }, true);
    }
  })();

  // 10. Quality (line: claude win rate + avg score)
  (function renderQuality() {
    const q = charts.quality;
    const hasData = q && Array.isArray(q.labels) && q.labels.length > 0;
    makeChart('chart-quality', {
      data: {
        labels: hasData ? q.labels : [],
        datasets: hasData
          ? [
              { type: 'line', label: 'Claude 勝率', data: q.winRateClaude || [], borderColor: PALETTE.primary, backgroundColor: PALETTE.primary, yAxisID: 'y', tension: 0.3 },
              { type: 'line', label: 'HF 勝率', data: q.winRateHf || [], borderColor: PALETTE.success, backgroundColor: PALETTE.success, yAxisID: 'y', tension: 0.3 },
              { type: 'bar', label: '平均スコア', data: q.avgScore || [], backgroundColor: PALETTE.primaryLight, yAxisID: 'y1' },
            ]
          : [],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { type: 'linear', position: 'left', beginAtZero: true, max: 1, title: { display: true, text: '勝率' } },
          y1: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'スコア' }, grid: { drawOnChartArea: false } },
        },
      },
    }, hasData);
  })();
})();
