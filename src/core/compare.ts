import type { SectionConfig } from "../types/config.types";
import type { ComparisonResult, SubtypeCoverage } from "../types/validation.types";
import { logger } from "../utils/logger";
import { buildIndexedAncestorCoverSet, normalizeUrl, normalizeUrlPattern } from "./normalize";

interface IndexedWithType {
  url: string;
  type: string;
}

export function compareUrls(
  expected: Set<string>,
  indexed: Set<string>,
  indexedWithTypes: IndexedWithType[],
  section: SectionConfig,
): ComparisonResult {
  void indexedWithTypes;

  const expectedNormPaths = [...new Set([...expected].map(normalizeUrl).filter((u) => u.length > 0))];
  const indexedNormPaths = [...new Set([...indexed].map(normalizeUrl).filter((u) => u.length > 0))];

  logger.debug(
    {
      section: section.name,
      sitemapSample: expectedNormPaths.slice(0, 3),
      searchSample: indexedNormPaths.slice(0, 3),
    },
    "URL comparison sample — checking for normalization mismatch",
  );

  const expectedSet = new Set(expectedNormPaths);
  const indexedSet = new Set(indexedNormPaths);

  const ancestorCover = buildIndexedAncestorCoverSet(indexedSet);
  const missingUrls = expectedNormPaths.filter((url) => !ancestorCover.has(url));
  const unexpectedUrls = indexedNormPaths.filter((url) => !expectedSet.has(url));
  const matchedCount = expectedNormPaths.length - missingUrls.length;

  const coveragePercent = computeCoveragePercent(expectedNormPaths.length, matchedCount);

  if (expectedNormPaths.length === 0 && indexedNormPaths.length > 0) {
    logger.warn(
      { section: section.name, indexedCount: indexedNormPaths.length },
      "Expected URL set is empty while indexed has entries.",
    );
  } else if (expectedNormPaths.length === 0 && indexedNormPaths.length === 0) {
    logger.info({ section: section.name }, "Both expected and indexed URL sets are empty.");
  } else if (indexedNormPaths.length === 0) {
    logger.warn(
      { section: section.name, expectedCount: expectedNormPaths.length },
      "Indexed URL set is empty.",
    );
  }

  const bySubtype = buildSubtypeCoverage(expectedNormPaths, indexedNormPaths, section);

  return {
    expectedCount: expectedNormPaths.length,
    indexedCount: indexedNormPaths.length,
    matchedCount,
    missingUrls,
    unexpectedUrls,
    coveragePercent,
    bySubtype,
  };
}

function buildSubtypeCoverage(
  expectedUrls: string[],
  indexedUrls: string[],
  section: SectionConfig,
): Record<string, SubtypeCoverage> {
  const subtypeToExpected = new Map<string, Set<string>>();
  const subtypeToIndexed = new Map<string, Set<string>>();

  expectedUrls.forEach((url) => {
    const subtype = classifySubtype(url, section);
    if (!subtypeToExpected.has(subtype)) {
      subtypeToExpected.set(subtype, new Set());
    }
    subtypeToExpected.get(subtype)?.add(url);
  });

  indexedUrls.forEach((url) => {
    const subtype = classifySubtype(url, section);
    if (!subtypeToIndexed.has(subtype)) {
      subtypeToIndexed.set(subtype, new Set());
    }
    subtypeToIndexed.get(subtype)?.add(url);
  });

  const allSubtypes = new Set<string>([
    ...subtypeToExpected.keys(),
    ...subtypeToIndexed.keys(),
    ...section.urlPatterns.map((pattern) => patternToSubtype(pattern)),
  ]);

  const result: Record<string, SubtypeCoverage> = {};
  allSubtypes.forEach((subtype) => {
    const expectedSet = subtypeToExpected.get(subtype) ?? new Set<string>();
    const indexedSet = subtypeToIndexed.get(subtype) ?? new Set<string>();
    const ancestorCoverSubtype = buildIndexedAncestorCoverSet(indexedSet);
    const missingForSubtype = [...expectedSet].filter((url) => !ancestorCoverSubtype.has(url));
    const matchedCount = expectedSet.size - missingForSubtype.length;

    result[subtype] = {
      subtype,
      expectedCount: expectedSet.size,
      indexedCount: indexedSet.size,
      matchedCount,
      missingUrls: missingForSubtype,
      coveragePercent: computeCoveragePercent(expectedSet.size, matchedCount),
    };
  });

  return result;
}

function classifySubtype(url: string, section: SectionConfig): string {
  if (section.name.trim().toLowerCase() === "people") {
    return "People";
  }

  const path = normalizeUrl(url);
  const matchedPattern = section.urlPatterns.find((pattern) => {
    const normalizedPattern = normalizeUrlPattern(pattern);
    return path === normalizedPattern || path.startsWith(`${normalizedPattern}/`);
  });

  if (!matchedPattern) {
    return "Other";
  }

  return patternToSubtype(matchedPattern);
}

function patternToSubtype(pattern: string): string {
  const normalized = normalizeUrlPattern(pattern);
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  const lastSegment = segments[segments.length - 1] ?? "other";
  return lastSegment
    .split("-")
    .map((token) => (token ? `${token[0].toUpperCase()}${token.slice(1)}` : token))
    .join("-");
}

function computeCoveragePercent(expectedCount: number, matchedCount: number): number {
  if (expectedCount === 0) {
    return matchedCount === 0 ? 100 : 0;
  }
  return Number(((matchedCount / expectedCount) * 100).toFixed(2));
}
