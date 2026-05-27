/**
 * Canonical form for comparing sitemap URLs with search index URLs:
 * pathname only (leading `/`), lowercase, no trailing slash (except root `/`),
 * no query or hash.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }

  try {
    let pathname: string;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      const u = new URL(trimmed);
      pathname = u.pathname;
    } else {
      const noHash = trimmed.split("#")[0] ?? trimmed;
      const noQuery = noHash.split("?")[0] ?? noHash;
      const withSlash = noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
      pathname = new URL(withSlash, "https://placeholder.invalid").pathname;
    }

    let p = pathname.toLowerCase();
    p = p.split("?")[0]?.split("#")[0] ?? p;
    if (p.length > 1) {
      p = p.replace(/\/+$/, "");
    }
    const base = p || "/";
    return decodeNormalizedPathSegments(base);
  } catch {
    const noFragment = trimmed.split("#")[0] ?? trimmed;
    const noQuery = noFragment.split("?")[0] ?? noFragment;
    let p = noQuery.trim().toLowerCase();
    if (!p.startsWith("/")) {
      p = `/${p}`;
    }
    if (p.length > 1) {
      p = p.replace(/\/+$/, "");
    }
    const base = p || "/";
    return decodeNormalizedPathSegments(base);
  }
}

function decodeNormalizedPathSegments(pathname: string): string {
  if (!pathname || pathname === "/") {
    return pathname || "/";
  }
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) {
        return "";
      }
      try {
        return decodeURIComponent(segment).toLowerCase();
      } catch {
        return segment.toLowerCase();
      }
    })
    .join("/");
}

/**
 * Paths that are indexed or are an ancestor of an indexed leaf path (`/insights/x`
 * is covered if any indexed URL is `/insights/x/...`). Used so sitemap “hub”
 * URLs align with Discover detail URLs without treating sibling paths as matches.
 */
export function buildIndexedAncestorCoverSet(indexedPaths: Iterable<string>): Set<string> {
  const cover = new Set<string>();
  for (const ip of indexedPaths) {
    let p = ip;
    while (p) {
      cover.add(p);
      const slash = p.lastIndexOf("/");
      if (slash <= 0) break;
      p = p.slice(0, slash);
    }
  }
  return cover;
}

export function normalizeUrls(urls: string[]): string[] {
  return urls.map(normalizeUrl);
}

/** Lowercase path prefix for config urlPatterns — must align with pathname from normalizeUrl(). */
export function normalizeUrlPattern(pattern: string): string {
  const clean = pattern.trim().toLowerCase().replace(/\/+$/, "") || "";
  const withSlash = clean.startsWith("/") ? clean : `/${clean}`;
  return withSlash || "/";
}

/**
 * True if normalized URL pathname is exactly the pattern or nested under it
 * (`/insights/blogs/x` matches pattern `/insights/blogs`).
 */
export function matchesPattern(url: string, patterns: string[]): boolean {
  const path = normalizeUrl(url);
  if (!path) {
    return false;
  }
  return patterns.some((pattern) => {
    const prefix = normalizeUrlPattern(pattern);
    if (prefix === "/") {
      return true;
    }
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

export function normalizeUrlWithLocale(
  url: string,
  options: { stripLocale: boolean; locales: string[] },
): string {
  const trimmed = url.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const cleanSegments = parsed.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.trim());

  let normalizedSegments = cleanSegments;
  if (options.stripLocale && normalizedSegments.length > 0) {
    const [firstSegment, ...rest] = normalizedSegments;
    const localeMatch = options.locales.some(
      (locale) => locale.toLowerCase() === firstSegment.toLowerCase(),
    );
    if (localeMatch) {
      normalizedSegments = rest;
    }
  }

  const normalizedPath = `/${normalizedSegments.join("/")}`.replace(/\/+$/, "") || "/";
  return `${parsed.origin}${normalizedPath}`;
}
