import type { ComparisonResult } from "../types/validation.types";
import type { ScanReport } from "../types/scan-report.types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Overall section card + subtype table + missing-by-subtype blocks. */
function renderSection(sectionName: string, comparison: ComparisonResult): string {
  const pct = comparison.coveragePercent;
  const barPct = Math.min(100, Math.max(0, pct));
  const statusIcon =
    pct >= 90 ? "✓" : pct >= 50 ? "⚠" : pct > 0 ? "⚠" : "✗";

  const showSubtypeTable = shouldShowSubtypeBreakdown(sectionName, comparison);

  const subtypeTableHtml = showSubtypeTable ? renderSubtypeTable(comparison) : "";

  const missingGroupedHtml = renderMissingBySubtype(sectionName, comparison);

  return `
    <article class="section-card">
      <header class="section-card__header">
        <h2 class="section-card__title">${escapeHtml(sectionName)}</h2>
        <span class="section-card__status" aria-hidden="true">${statusIcon}</span>
      </header>
      <div class="coverage-overall">
        <div class="coverage-overall__percent">${pct.toFixed(2)}%</div>
        <div class="bar bar--large" role="presentation">
          <div class="bar__fill bar__fill--overall" style="width:${barPct}%"></div>
        </div>
      </div>
      <div class="section-meta">
        <span><strong>Expected:</strong> ${formatInt(comparison.expectedCount)}</span>
        <span><strong>Indexed:</strong> ${formatInt(comparison.indexedCount)}</span>
      </div>
      ${subtypeTableHtml}
      ${missingGroupedHtml}
    </article>
  `;
}

function shouldShowSubtypeBreakdown(sectionName: string, comparison: ComparisonResult): boolean {
  if (sectionName.trim().toLowerCase() === "people") {
    return false;
  }
  const rows = getSubtypeRowsForTable(comparison);
  return rows.length > 0;
}

function getSubtypeRowsForTable(comparison: ComparisonResult): {
  subtype: string;
  expectedCount: number;
  indexedCount: number;
  coveragePercent: number;
}[] {
  const rows = Object.values(comparison.bySubtype).filter((s) => s.expectedCount > 0);
  return rows.sort((a, b) => a.coveragePercent - b.coveragePercent);
}

function renderSubtypeTable(comparison: ComparisonResult): string {
  const rows = getSubtypeRowsForTable(comparison);
  if (rows.length === 0) {
    return "";
  }

  const body = rows
    .map((r) => {
      const badgeOrTick = coverageCell(r.coveragePercent);
      const miniBar = `
        <div class="mini-bar-track" aria-hidden="true">
          <div class="mini-bar-fill ${miniBarToneClass(r.coveragePercent)}" style="width:${Math.min(100, Math.max(0, r.coveragePercent))}%"></div>
        </div>`;
      return `
        <tr>
          <td class="col-subtype">${escapeHtml(r.subtype)}</td>
          <td class="col-num">${formatInt(r.expectedCount)}</td>
          <td class="col-num">${formatInt(r.indexedCount)}</td>
          <td class="col-coverage">
            ${badgeOrTick}
            ${miniBar}
          </td>
        </tr>`;
    })
    .join("");

  return `
    <section class="by-type">
      <h3 class="by-type__heading">BY TYPE</h3>
      <table class="subtype-table">
        <thead>
          <tr>
            <th class="col-subtype">Subtype</th>
            <th class="col-num">Expected</th>
            <th class="col-num">Indexed</th>
            <th class="col-coverage">Coverage</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  `;
}

function coverageCell(coveragePercent: number): string {
  if (coveragePercent === 100) {
    return `<span class="cov-tick" title="100% coverage">✓</span>`;
  }
  const badgeClass =
    coveragePercent >= 90 ? "badge badge--green" : coveragePercent >= 50 ? "badge badge--amber" : "badge badge--red";
  return `<span class="${badgeClass}">${coveragePercent.toFixed(0)}%</span>`;
}

function miniBarToneClass(coveragePercent: number): string {
  if (coveragePercent >= 90) {
    return "mini-bar-fill--good";
  }
  if (coveragePercent >= 50) {
    return "mini-bar-fill--warn";
  }
  return "mini-bar-fill--bad";
}

function renderMissingBySubtype(sectionName: string, comparison: ComparisonResult): string {
  const totalMissing = comparison.missingUrls.length;
  if (totalMissing === 0) {
    return "";
  }

  const groups = Object.entries(comparison.bySubtype)
    .map(([subtypeKey, cov]) => ({ subtypeKey, subtype: cov.subtype || subtypeKey, missing: cov.missingUrls }))
    .filter((g) => g.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length);

  if (groups.length === 0) {
    return `
      <section class="missing-flat">
        <h3 class="missing__heading">${escapeHtml(sectionName)} — ${formatInt(totalMissing)} missing URLs</h3>
        <ul class="missing-list">${comparison.missingUrls.map((u) => `<li><code>${escapeHtml(u)}</code></li>`).join("")}</ul>
      </section>`;
  }

  const blocks = groups
    .map(
      (g) => `
    <details class="missing-group">
      <summary class="missing-group__summary">${escapeHtml(g.subtype)} (${formatInt(g.missing.length)} missing)</summary>
      <ul class="missing-list">${g.missing.map((u) => `<li><code>${escapeHtml(u)}</code></li>`).join("")}</ul>
    </details>`,
    )
    .join("\n");

  return `
    <section class="missing-section">
      <h3 class="missing__heading">${escapeHtml(sectionName)} — ${formatInt(totalMissing)} missing URLs</h3>
      <div class="missing-groups">${blocks}</div>
    </section>
  `;
}

export function generateScanReportHtml(report: ScanReport): string {
  const sectionsHtml = report.sections
    .map((sec) => renderSection(sec.section, sec.comparison))
    .join("\n");

  const findingsBanner = `
    <dl class="summary-findings">
      <div><dt>Info</dt><dd>${report.findingCounts.info}</dd></div>
      <div><dt>Warnings</dt><dd>${report.findingCounts.warning}</dd></div>
      <div><dt>Critical</dt><dd>${report.findingCounts.critical}</dd></div>
    </dl>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Scan — ${escapeHtml(report.targetName)}</title>
  <style>
    :root {
      --bg: #0f1419;
      --card: #1a2332;
      --text: #e7ecf3;
      --muted: #8b98a8;
      --border: #2d3a4d;
      --green: #3ecf8e;
      --green-dim: #1f5c40;
      --amber: #e8b749;
      --amber-dim: #5c4a1f;
      --red: #f56565;
      --red-dim: #6b3030;
      --accent: #4c9dff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 1.75rem clamp(1rem, 4vw, 2.5rem) 3rem;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      max-width: 52rem;
      margin-inline: auto;
    }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: .25rem; }
    .summary-meta { color: var(--muted); font-size: .875rem; margin-bottom: 1.25rem; }
    .summary-findings {
      display: flex; gap: 1.5rem; flex-wrap: wrap;
      background: var(--card); padding: .75rem 1rem; border-radius: .5rem; border: 1px solid var(--border);
      margin-bottom: 1.75rem;
    }
    .summary-findings dt { margin: 0; color: var(--muted); font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
    .summary-findings dd { margin: .15rem 0 0 0; font-weight: 600; font-size: 1.1rem; }

    .section-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: .75rem;
      padding: 1.25rem 1.35rem;
      margin-bottom: 1.5rem;
    }
    .section-card__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: .75rem; }
    .section-card__title { margin: 0; font-size: 1.2rem; font-weight: 600; }
    .section-card__status { font-size: 1.1rem; opacity: .85; }

    .coverage-overall__percent { font-size: 1.35rem; font-weight: 600; margin-bottom: .35rem; }
    .bar { height: .55rem; background: #2a3544; border-radius: 999px; overflow: hidden; }
    .bar--large { height: .65rem; }
    .bar__fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--green)); min-width: 0; transition: width .4s ease; }

    .section-meta { margin: 1rem 0 1rem; display: flex; gap: 1.5rem; color: var(--muted); font-size: .925rem; }
    .section-meta strong { color: var(--text); }

    .by-type__heading, .missing__heading {
      font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 1.25rem 0 .65rem;
    }

    .subtype-table { width: 100%; border-collapse: collapse; font-size: .875rem; }
    .subtype-table th { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid var(--border); color: var(--muted); font-weight: 500; text-transform: uppercase; font-size: .68rem; letter-spacing: .05em; }
    .subtype-table th.col-num, .subtype-table td.col-num { text-align: right; }
    .subtype-table td { padding: .5rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
    .subtype-table tbody tr:last-child td { border-bottom: none; }
    .col-coverage { min-width: 7.5rem; }

    .badge { display: inline-flex; align-items: center; justify-content: center; min-width: 2.35rem; padding: .15rem .4rem; border-radius: .25rem; font-size: .75rem; font-weight: 600; }
    .badge--green { background: var(--green-dim); color: var(--green); }
    .badge--amber { background: var(--amber-dim); color: var(--amber); }
    .badge--red { background: var(--red-dim); color: var(--red); }

    .cov-tick {
      display: inline-flex; align-items: center; justify-content: center;
      width: 1.5rem; height: 1.5rem; border-radius: .25rem; font-weight: 700;
      background: var(--green-dim); color: var(--green); vertical-align: middle;
    }

    .mini-bar-track {
      margin-top: .35rem; height: .2rem; background: #2a3544; border-radius: 999px; overflow: hidden;
    }
    .mini-bar-fill { height: 100%; border-radius: 999px; }
    .mini-bar-fill--good { background: var(--green); }
    .mini-bar-fill--warn { background: var(--amber); }
    .mini-bar-fill--bad { background: var(--red); }

    .missing-section { margin-top: 1.25rem; padding-top: .5rem; border-top: 1px solid var(--border); }
    .missing-group {
      margin: .5rem 0 .75rem; border: 1px solid var(--border); border-radius: .45rem;
      overflow: clip; background: rgba(0,0,0,.12);
    }
    .missing-group__summary {
      cursor: pointer; padding: .55rem .75rem; font-weight: 600; font-size: .88rem;
      list-style-position: outside; outline: none;
    }
    .missing-group__summary::-webkit-details-marker { color: var(--muted); }
    .missing-group[open] .missing-group__summary { border-bottom: 1px solid var(--border); }
    .missing-list { margin: 0; padding: .35rem .75rem .75rem 1.5rem; max-height: min(320px, 40vh); overflow-y: auto; }
    .missing-list li { margin: .2rem 0; font-size: .8rem; }
    .missing-list code { word-break: break-all; font-family: ui-monospace, monospace; color: var(--muted); font-size: .78rem; }

    .missing-flat .missing-list { max-height: min(420px, 50vh); }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(report.targetName)}</h1>
    <p class="summary-meta">
      Environment: <strong>${escapeHtml(report.environment)}</strong> ·
      ${escapeHtml(report.startedAt)} → ${escapeHtml(report.completedAt)} ·
      ${(report.durationMs / 1000).toFixed(1)}s
    </p>
    ${findingsBanner}
  </header>
  <main>${sectionsHtml}</main>
</body>
</html>`;
}
