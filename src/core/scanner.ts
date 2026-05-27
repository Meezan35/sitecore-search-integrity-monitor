import { compareUrls } from "./compare";
import { matchesPattern } from "./normalize";
import type { UrlSource } from "../types/connector.types";
import type { SectionConfig } from "../types/config.types";
import type { ComparisonResult } from "../types/validation.types";
import { logger } from "../utils/logger";

export interface SectionScanInput {
  section: SectionConfig;
  sitemapSource: UrlSource;
  indexedSource: UrlSource;
}

export async function scanSection(input: SectionScanInput): Promise<ComparisonResult> {
  const startedAt = Date.now();
  logger.info({ section: input.section.name }, "Starting section scan");

  const allSitemapUrls = await input.sitemapSource.getUrls();

  const sectionSitemapUrls = new Set<string>();
  for (const url of allSitemapUrls) {
    if (matchesPattern(url, input.section.urlPatterns)) {
      sectionSitemapUrls.add(url);
    }
  }

  const indexedUrls = await input.indexedSource.getUrls();

  const result = compareUrls(
    sectionSitemapUrls,
    new Set(indexedUrls),
    indexedUrls.map((url) => ({ url, type: "" })),
    input.section,
  );

  logger.info(
    {
      section: input.section.name,
      expectedCount: result.expectedCount,
      indexedCount: result.indexedCount,
      coveragePercent: result.coveragePercent,
      durationMs: Date.now() - startedAt,
    },
    "Section scan completed",
  );

  return result;
}
