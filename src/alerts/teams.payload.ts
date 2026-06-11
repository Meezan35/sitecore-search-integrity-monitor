import { countByMissingType } from "../core/classify-missing";
import type { ScanReport } from "../types/scan-report.types";

/** Scan JSON shape written by the monitor (alias for clarity in alerting). */
export type ScanRecord = ScanReport;

function sectionEmoji(coveragePercent: number): string {
  if (coveragePercent >= 90) return "✅";
  if (coveragePercent >= 50) return "⚠️";
  return "❌";
}

function formatSectionFactValue(sec: ScanRecord["sections"][number]): string {
  const cov = sec.comparison.coveragePercent;
  const classified = sec.comparison.classifiedMissing ?? [];
  const missing = sec.comparison.missingUrls.length;
  const unexpected = sec.comparison.unexpectedUrls.length;

  if (classified.length === 0) {
    return `${cov.toFixed(2)}% · ${missing} missing · ${unexpected} unexpected`;
  }

  const counts = countByMissingType(classified);
  const parts = [`${cov.toFixed(2)}%`];

  if (counts["not-indexed"] > 0) {
    parts.push(`${counts["not-indexed"]} not indexed`);
  }
  if (counts.mismatch > 0) {
    parts.push(`${counts.mismatch} URL mismatches`);
  }
  if (counts["bucket-url"] > 0) {
    parts.push(`${counts["bucket-url"]} bucket URL${counts["bucket-url"] === 1 ? "" : "s"}`);
  }
  if (counts["suspect-test"] > 0) {
    parts.push(`${counts["suspect-test"]} suspect test`);
  }

  return parts.join(" · ");
}

function formatFacts(scan: ScanRecord): { name: string; value: string }[] {
  return scan.sections.map((sec) => ({
    name: `${sectionEmoji(sec.comparison.coveragePercent)} ${sec.section}`,
    value: formatSectionFactValue(sec),
  }));
}

function collectMessages(
  scan: ScanRecord,
  severity: "critical" | "warning",
): string[] {
  const out: string[] = [];
  for (const sec of scan.sections) {
    for (const f of sec.findings) {
      if (f.severity === severity) {
        out.push(f.message);
      }
    }
  }
  return out;
}

/**
 * Builds a Microsoft Teams MessageCard payload (Office 365 Connector style).
 * @param scan Latest scan report, or null when no JSON output exists
 * @param repoUrl Repository root URL (e.g. https://github.com/org/repo)
 * @param runId GitHub Actions run id
 */
export function buildTeamsPayload(scan: ScanRecord | null, repoUrl: string, runId: string): object {
  const actionsUrl = `${repoUrl}/actions/runs/${runId}`;
  const now = new Date().toISOString();

  if (!scan) {
    return {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: "DC2626",
      summary: "Sitecore Search Monitor — scan failed",
      title: "❌ Sitecore Search Monitor — Scan Failed to Run",
      subtitle: now,
      text: "No scan output was produced. Check the GitHub Actions log.",
      potentialAction: [
        {
          "@type": "OpenUri",
          name: "View Actions Log",
          targets: [{ os: "default", uri: actionsUrl }],
        },
      ],
    };
  }

  const hasAnyCritical = scan.sections.some((s) => s.findings.some((f) => f.severity === "critical"));
  const hasAnyWarning = scan.sections.some((s) => s.findings.some((f) => f.severity === "warning"));

  const status = hasAnyCritical ? "critical" : hasAnyWarning ? "warning" : "healthy";
  const themeColor = hasAnyCritical ? "DC2626" : hasAnyWarning ? "D97706" : "059669";
  const emoji = hasAnyCritical ? "❌" : hasAnyWarning ? "⚠️" : "✅";
  const statusText = hasAnyCritical ? "Issues Found" : hasAnyWarning ? "Warnings Detected" : "All Healthy";

  const durationSeconds = Math.round(scan.durationMs / 1000);
  const scanId = `${scan.startedAt}`;

  const sections: object[] = [
    {
      activityTitle: `${emoji} ${statusText}`,
      facts: formatFacts(scan),
      markdown: false,
    },
  ];

  if (hasAnyCritical) {
    const bullets = collectMessages(scan, "critical")
      .map((m) => `• ${m}`)
      .join("\n");
    sections.push({
      title: "🔴 Critical Issues",
      text: bullets || "• (no message text)",
      markdown: true,
    });
  } else if (hasAnyWarning) {
    const bullets = collectMessages(scan, "warning")
      .map((m) => `• ${m}`)
      .join("\n");
    sections.push({
      title: "🟡 Warnings",
      text: bullets || "• (no message text)",
      markdown: true,
    });
  }

  sections.push({
    text: `Scan ID: ${scanId} · Duration: ${durationSeconds}s · ${scan.environment}`,
    markdown: false,
  });

  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor,
    summary: `Sitecore Search Monitor — ${statusText}`,
    title: `${emoji} Sitecore Search Monitor`,
    subtitle: `${statusText} · ${now}`,
    sections,
    potentialAction: [
      {
        "@type": "OpenUri",
        name: "📊 Download Full Report",
        targets: [{ os: "default", uri: actionsUrl }],
      },
    ],
  };
}
