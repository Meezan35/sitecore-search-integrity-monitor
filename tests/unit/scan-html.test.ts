import { describe, expect, it } from "vitest";

import { generateScanReportHtml } from "../../src/report/generate-scan-html";
import type { ScanReport } from "../../src/types/scan-report.types";
import type { ComparisonResult } from "../../src/types/validation.types";

function baseComparison(overrides: Partial<ComparisonResult> = {}): ComparisonResult {
  return {
    expectedCount: 100,
    indexedCount: 90,
    matchedCount: 90,
    missingUrls: [],
    unexpectedUrls: [],
    coveragePercent: 90,
    bySubtype: {},
    ...overrides,
  };
}

describe("generateScanReportHtml", () => {
  it("includes BY TYPE table with worst coverage first", () => {
    const report: ScanReport = {
      targetName: "T",
      environment: "qa",
      configPath: "/x.json",
      startedAt: "",
      completedAt: "",
      durationMs: 1,
      findingCounts: { info: 0, warning: 0, critical: 0 },
      sections: [
        {
          section: "Insights",
          findings: [],
          comparison: baseComparison({
            coveragePercent: 92.67,
            bySubtype: {
              Blogs: {
                subtype: "Blogs",
                expectedCount: 100,
                indexedCount: 80,
                matchedCount: 80,
                missingUrls: [],
                coveragePercent: 80,
              },
              Articles: {
                subtype: "Articles",
                expectedCount: 50,
                indexedCount: 49,
                matchedCount: 49,
                missingUrls: ["/insights/articles/a"],
                coveragePercent: 98,
              },
            },
          }),
        },
      ],
    };

    const html = generateScanReportHtml(report);
    expect(html).toContain("BY TYPE");
    expect(html).toContain("Blogs");
    expect(html).toContain("Articles");
    expect(html.indexOf("Blogs")).toBeLessThan(html.indexOf("Articles"));
  });

  it("omits subtype table for People section", () => {
    const report: ScanReport = {
      targetName: "T",
      environment: "qa",
      configPath: "/x.json",
      startedAt: "",
      completedAt: "",
      durationMs: 1,
      findingCounts: { info: 0, warning: 0, critical: 0 },
      sections: [
        {
          section: "People",
          findings: [],
          comparison: baseComparison({
            bySubtype: {
              People: {
                subtype: "People",
                expectedCount: 10,
                indexedCount: 10,
                matchedCount: 10,
                missingUrls: [],
                coveragePercent: 100,
              },
            },
          }),
        },
      ],
    };

    const html = generateScanReportHtml(report);
    expect(html).not.toContain("BY TYPE");
  });

  it("groups missing URLs by subtype; most missing first", () => {
    const report: ScanReport = {
      targetName: "T",
      environment: "qa",
      configPath: "/x.json",
      startedAt: "",
      completedAt: "",
      durationMs: 1,
      findingCounts: { info: 0, warning: 0, critical: 0 },
      sections: [
        {
          section: "Insights",
          findings: [],
          comparison: baseComparison({
            expectedCount: 4,
            indexedCount: 1,
            matchedCount: 1,
            coveragePercent: 25,
            missingUrls: ["/insights/blogs/b", "/insights/articles/a", "/insights/articles/b<x"],
            bySubtype: {
              Blogs: {
                subtype: "Blogs",
                expectedCount: 1,
                indexedCount: 0,
                matchedCount: 0,
                missingUrls: ["/insights/blogs/b"],
                coveragePercent: 0,
              },
              Articles: {
                subtype: "Articles",
                expectedCount: 2,
                indexedCount: 0,
                matchedCount: 0,
                missingUrls: ["/insights/articles/a", "/insights/articles/b<x"],
                coveragePercent: 0,
              },
            },
          }),
        },
      ],
    };

    const html = generateScanReportHtml(report);
    expect(html).toContain("missing URLs");
    expect(html).toContain("Articles (2 missing)");
    expect(html).toContain("Blogs (1 missing)");
    expect(html.indexOf("Articles (2 missing)")).toBeLessThan(
      html.indexOf("Blogs (1 missing)")
    );
    expect(html).toContain("&lt;");
  });

  it("shows green tick for 100% subtype coverage", () => {
    const report: ScanReport = {
      targetName: "T",
      environment: "qa",
      configPath: "/x.json",
      startedAt: "",
      completedAt: "",
      durationMs: 1,
      findingCounts: { info: 0, warning: 0, critical: 0 },
      sections: [
        {
          section: "Insights",
          findings: [],
          comparison: baseComparison({
            coveragePercent: 100,
            bySubtype: {
              Blogs: {
                subtype: "Blogs",
                expectedCount: 2,
                indexedCount: 2,
                matchedCount: 2,
                missingUrls: [],
                coveragePercent: 100,
              },
            },
          }),
        },
      ],
    };

    const html = generateScanReportHtml(report);
    expect(html).toContain("cov-tick");
    expect(html).toContain('title="100% coverage"');
  });
});
