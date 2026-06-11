export type MissingUrlType = "mismatch" | "bucket-url" | "not-indexed" | "suspect-test";

export interface ClassifiedUrl {
  url: string;
  type: MissingUrlType;
  explanation: string;
  relatedUrl?: string;
}

const SUSPECT_TEST_EXPLANATION =
  "Slug pattern suggests test or duplicate content. Verify this belongs in the production sitemap.";

const BUCKET_URL_EXPLANATION =
  "Indexed under a folder-style path. Sitemap uses flat path, search index uses nested structure.";

const MISMATCH_EXPLANATION =
  "Indexed under a similar but different URL. Likely a typo or slug change in the search index.";

const NOT_INDEXED_EXPLANATION =
  "No matching URL found in the search index. Page exists in sitemap but is not indexed, or was removed from the index.";

function lastPathSegment(url: string): string {
  const trimmed = url.replace(/\/$/, "");
  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "";
}

function isSuspectTestSlug(slug: string): boolean {
  const lower = slug.toLowerCase();
  if (lower.includes("test") || lower.includes("duplicate") || lower.includes("demo")) {
    return true;
  }
  if (/\d$/.test(slug)) {
    return true;
  }
  if (/[a-zA-Z]\d[a-zA-Z]/.test(slug)) {
    return true;
  }
  return false;
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

function characterOverlap(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 1;
  }

  const remaining = b.split("");
  let matching = 0;
  for (const char of a) {
    const index = remaining.indexOf(char);
    if (index >= 0) {
      matching++;
      remaining.splice(index, 1);
    }
  }

  return matching / maxLen;
}

function isMismatchCandidate(missingSlug: string, unexpectedSlug: string): boolean {
  if (missingSlug === unexpectedSlug) {
    return false;
  }
  if (levenshtein(missingSlug, unexpectedSlug) <= 3) {
    return true;
  }
  if (missingSlug.includes(unexpectedSlug) || unexpectedSlug.includes(missingSlug)) {
    return true;
  }
  if (characterOverlap(missingSlug, unexpectedSlug) >= 0.8) {
    return true;
  }
  return false;
}

function similarityScore(missingSlug: string, unexpectedSlug: string): number {
  const overlap = characterOverlap(missingSlug, unexpectedSlug);
  const distance = levenshtein(missingSlug, unexpectedSlug);
  const substringBonus =
    missingSlug.includes(unexpectedSlug) || unexpectedSlug.includes(missingSlug) ? 1 : 0;
  return overlap * 100 + substringBonus * 50 - distance;
}

function findBucketMatch(missingUrl: string, unexpectedUrls: string[]): string | undefined {
  const missingSlug = lastPathSegment(missingUrl);
  return unexpectedUrls.find((url) => lastPathSegment(url) === missingSlug);
}

function findMismatchMatch(missingUrl: string, unexpectedUrls: string[]): string | undefined {
  const missingSlug = lastPathSegment(missingUrl);
  let bestUrl: string | undefined;
  let bestScore = -Infinity;

  for (const url of unexpectedUrls) {
    const unexpectedSlug = lastPathSegment(url);
    if (!isMismatchCandidate(missingSlug, unexpectedSlug)) {
      continue;
    }
    const score = similarityScore(missingSlug, unexpectedSlug);
    if (score > bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }

  return bestUrl;
}

function classifySingleUrl(missingUrl: string, unexpectedUrls: string[]): ClassifiedUrl {
  const slug = lastPathSegment(missingUrl);

  if (isSuspectTestSlug(slug)) {
    return {
      url: missingUrl,
      type: "suspect-test",
      explanation: SUSPECT_TEST_EXPLANATION,
    };
  }

  const bucketMatch = findBucketMatch(missingUrl, unexpectedUrls);
  if (bucketMatch) {
    return {
      url: missingUrl,
      type: "bucket-url",
      explanation: BUCKET_URL_EXPLANATION,
      relatedUrl: bucketMatch,
    };
  }

  const mismatchMatch = findMismatchMatch(missingUrl, unexpectedUrls);
  if (mismatchMatch) {
    return {
      url: missingUrl,
      type: "mismatch",
      explanation: MISMATCH_EXPLANATION,
      relatedUrl: mismatchMatch,
    };
  }

  return {
    url: missingUrl,
    type: "not-indexed",
    explanation: NOT_INDEXED_EXPLANATION,
  };
}

export function classifyMissingUrls(
  missingUrls: string[],
  unexpectedUrls: string[],
): ClassifiedUrl[] {
  if (missingUrls.length === 0) {
    return [];
  }

  return missingUrls.map((url) => classifySingleUrl(url, unexpectedUrls));
}

export function countByMissingType(classified: ClassifiedUrl[]): Record<MissingUrlType, number> {
  return {
    mismatch: classified.filter((c) => c.type === "mismatch").length,
    "bucket-url": classified.filter((c) => c.type === "bucket-url").length,
    "not-indexed": classified.filter((c) => c.type === "not-indexed").length,
    "suspect-test": classified.filter((c) => c.type === "suspect-test").length,
  };
}
