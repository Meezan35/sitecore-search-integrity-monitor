import { describe, expect, it } from "vitest";

import { classifyMissingUrls } from "../../src/core/classify-missing";
import { buildTeamsPayload, type ScanRecord } from "../../src/alerts/teams.payload";
import type { ScanSectionReport } from "../../src/types/scan-report.types";

const baseSection = (name: string, coverage: number, findings: ScanSectionReport["findings"]): ScanSectionReport => ({
  section: name,
  comparison: {
    expectedCount: 10,
    indexedCount: 10,
    matchedCount: 10,
    missingUrls: [],
    unexpectedUrls: [],
    coveragePercent: coverage,
    bySubtype: {},
    classifiedMissing: [],
  },
  findings,
});

const baseScan = (sections: ScanSectionReport[]): ScanRecord => ({
  targetName: "T",
  environment: "production",
  configPath: "/c.json",
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:01:00.000Z",
  durationMs: 60000,
  sections,
  findingCounts: { info: 0, warning: 0, critical: 0 },
});

describe("buildTeamsPayload", () => {
  const repo = "https://github.com/org/repo";
  const runId = "12345";

  it("returns failure MessageCard when scan is null", () => {
    const p = buildTeamsPayload(null, repo, runId) as Record<string, unknown>;
    expect(p["@type"]).toBe("MessageCard");
    expect(p.themeColor).toBe("DC2626");
    expect(p.title).toContain("Scan Failed to Run");
    expect(JSON.stringify(p)).toContain("/actions/runs/12345");
  });

  it("uses healthy theme when no critical or warning findings", () => {
    const scan = baseScan([
      baseSection("Insights", 95, [
        { severity: "info", code: "COVERAGE_HEALTHY", message: "ok", section: "Insights" },
      ]),
    ]);
    const p = buildTeamsPayload(scan, repo, runId) as Record<string, unknown>;
    expect(p.themeColor).toBe("059669");
    expect(p.title).toContain("✅");
    const sections = p.sections as object[];
    const texts = JSON.stringify(sections);
    expect(texts).not.toContain("Critical Issues");
    expect(texts).not.toContain("Warnings");
  });

  it("includes critical section when any critical finding exists", () => {
    const scan = baseScan([
      baseSection("People", 40, [
        {
          severity: "critical",
          code: "X",
          message: "People coverage critical",
          section: "People",
        },
      ]),
    ]);
    const p = buildTeamsPayload(scan, repo, runId) as Record<string, unknown>;
    expect(p.themeColor).toBe("DC2626");
    const sections = p.sections as { title?: string; text?: string }[];
    const crit = sections.find((s) => s.title === "🔴 Critical Issues");
    expect(crit?.text).toContain("People coverage critical");
    const warn = sections.find((s) => s.title === "🟡 Warnings");
    expect(warn).toBeUndefined();
  });

  it("shows warnings section only when warnings and no critical", () => {
    const scan = baseScan([
      baseSection("Insights", 85, [
        { severity: "warning", code: "W", message: "Low coverage", section: "Insights" },
      ]),
    ]);
    const p = buildTeamsPayload(scan, repo, runId) as Record<string, unknown>;
    expect(p.themeColor).toBe("D97706");
    const sections = p.sections as { title?: string }[];
    expect(sections.some((s) => s.title === "🟡 Warnings")).toBe(true);
    expect(sections.some((s) => s.title === "🔴 Critical Issues")).toBe(false);
  });

  it("formats per-section facts with coverage and counts when unclassified", () => {
    const scan = baseScan([
      {
        section: "Insights",
        comparison: {
          expectedCount: 100,
          indexedCount: 90,
          matchedCount: 90,
          missingUrls: ["/a"],
          unexpectedUrls: ["/b"],
          coveragePercent: 90,
          bySubtype: {},
          classifiedMissing: [],
        },
        findings: [],
      },
    ]);
    const p = buildTeamsPayload(scan, repo, runId) as Record<string, unknown>;
    const sections = p.sections as { facts?: { name: string; value: string }[] }[];
    const facts = sections[0]?.facts ?? [];
    expect(facts[0]?.name).toContain("Insights");
    expect(facts[0]?.value).toContain("90.00%");
    expect(facts[0]?.value).toContain("1 missing");
    expect(facts[0]?.value).toContain("1 unexpected");
  });

  it("formats per-section facts with classified counts when available", () => {
    const missingUrls = ["/people/luis-abreu", "/people/caceres-christie", "/people/daniel-flores"];
    const unexpectedUrls = ["/people/luiss-abreuu", "/people/c/a/caceres-christie"];
    const scan = baseScan([
      {
        section: "People",
        comparison: {
          expectedCount: 100,
          indexedCount: 97,
          matchedCount: 97,
          missingUrls,
          unexpectedUrls,
          coveragePercent: 96.58,
          bySubtype: {},
          classifiedMissing: classifyMissingUrls(missingUrls, unexpectedUrls),
        },
        findings: [],
      },
    ]);
    const p = buildTeamsPayload(scan, repo, runId) as Record<string, unknown>;
    const sections = p.sections as { facts?: { name: string; value: string }[] }[];
    const facts = sections[0]?.facts ?? [];
    expect(facts[0]?.value).toContain("96.58%");
    expect(facts[0]?.value).toContain("1 not indexed");
    expect(facts[0]?.value).toContain("1 URL mismatches");
    expect(facts[0]?.value).toContain("1 bucket URL");
    expect(facts[0]?.value).not.toContain("missing");
  });
});
