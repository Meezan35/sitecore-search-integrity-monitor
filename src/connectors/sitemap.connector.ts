import axios from "axios";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";

import { ScanAbortError } from "../errors/scan-abort-error";
import { normalizeUrlWithLocale } from "../core/normalize";
import type { UrlSource } from "../types/connector.types";
import type { SitemapConfig } from "../types/config.types";
import { logger } from "../utils/logger";
import { withRetry } from "../utils/retry";
import { sleep } from "../utils/sleep";

type SitemapType = "index" | "urlset" | "unknown";
type XmlNode = Record<string, unknown>;

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);

const DEFAULT_BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; SitecoreSearchMonitor/1.0)",
  Accept: "application/xml, text/xml;q=0.9, */*;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
} as const;

const PRODUCTION_FETCH_DEFAULTS = {
  initialDelayMs: 0,
  retries: 8,
  baseDelayMs: 1000,
  maxDelayMs: 10_000,
  timeoutMs: 30_000,
} as const;

const VITEST_FETCH = {
  initialDelayMs: 0,
  retries: 4,
  baseDelayMs: 1,
  maxDelayMs: 5,
  timeoutMs: 10_000,
} as const;

type SitemapFetchResolved = {
  initialDelayMs: number;
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  userAgent: string;
  referer?: string;
};

export { ScanAbortError } from "../errors/scan-abort-error";

export class SitemapConnector implements UrlSource {
  private readonly parser: XMLParser;

  constructor(private readonly config: SitemapConfig) {
    this.parser = new XMLParser();
  }

  async getUrls(): Promise<string[]> {
    const strategy = this.config.fetchStrategy ?? "http";
    if (strategy === "file") {
      return this.getUrlsFromLocalFile();
    }
    if (strategy !== "http") {
      throw new ScanAbortError(
        `SitemapConnector only supports "http" and "file" strategies; got "${strategy}".`,
      );
    }
    return this.getUrlsHttp();
  }

  private async getUrlsFromLocalFile(): Promise<string[]> {
    const startedAt = Date.now();
    const localPath = this.config.localFilePath;
    if (localPath == null || localPath.trim().length === 0) {
      throw new ScanAbortError("sitemap.localFilePath is required when fetchStrategy is \"file\".");
    }

    const resolvedPath = isAbsolute(localPath) ? resolve(localPath) : join(process.cwd(), localPath);
    let rootXml: string;
    try {
      rootXml = readFileSync(resolvedPath, "utf8");
    } catch (error) {
      throw new ScanAbortError(
        `Sitemap file not found or unreadable: ${resolvedPath}`,
        error,
      );
    }

    const fetch = this.resolveFetchSettings();
    const gapMs = this.config.delayBetweenRequestsMs;

    logger.info(
      {
        localFilePath: resolvedPath,
        delayBetweenRequestsMs: gapMs,
      },
      "Starting sitemap read from local file",
    );

    const pageUrls: string[] = [];
    const parsed = this.parser.parse(rootXml) as XmlNode;
    const type = this.detectType(parsed);

    if (type === "index") {
      pageUrls.push(...(await this.handleSitemapIndex(parsed, fetch, gapMs, resolvedPath)));
    } else if (type === "urlset") {
      pageUrls.push(...this.handleUrlSet(parsed));
    } else {
      logger.warn({ localFilePath: resolvedPath }, "Unknown root sitemap document type");
    }

    const uniqueUrls = [...new Set(pageUrls)];
    logger.info(
      {
        urlCount: uniqueUrls.length,
        durationMs: Date.now() - startedAt,
      },
      "Local sitemap scan finished",
    );
    return uniqueUrls;
  }

  /** Strategy: HTTP — fetch from network (optional child URL list skips root). */
  private async getUrlsHttp(): Promise<string[]> {
    const startedAt = Date.now();
    const fetch = this.resolveFetchSettings();
    const gapMs = this.config.delayBetweenRequestsMs;
    const entries = this.getHttpEntryUrls();
    const usingChildOverride =
      Array.isArray(this.config.childSitemapUrls) && this.config.childSitemapUrls.length > 0;
    logger.info(
      {
        entryCount: entries.length,
        usingChildOverride,
        rootUrl: this.config.url,
        delayBetweenRequestsMs: gapMs,
        fetchStrategy: "http",
      },
      "Starting sitemap fetch",
    );

    if (fetch.initialDelayMs > 0) {
      await sleep(fetch.initialDelayMs);
    }

    const pageUrls: string[] = [];
    let isFirstEntry = true;

    for (const entryUrl of entries) {
      if (!isFirstEntry) {
        await sleep(gapMs);
      }
      isFirstEntry = false;

      let entryXml: string;
      try {
        entryXml = await this.fetchXmlWithRetry(entryUrl, fetch);
      } catch (error) {
        if (this.isEnotfound(error)) {
          throw new ScanAbortError(
            `DNS resolution failed for ${entryUrl}. Check network connectivity and VPN status.`,
            error,
          );
        }
        throw new ScanAbortError(`Failed to fetch sitemap after retries: ${entryUrl}`, error);
      }

      const parsed = this.parser.parse(entryXml) as XmlNode;
      const type = this.detectType(parsed);

      if (type === "index") {
        pageUrls.push(...(await this.handleSitemapIndex(parsed, fetch, gapMs)));
      } else if (type === "urlset") {
        pageUrls.push(...this.handleUrlSet(parsed));
      } else {
        logger.warn({ entryUrl }, "Unknown sitemap document type");
      }
    }

    const uniqueUrls = [...new Set(pageUrls)];
    logger.info(
      {
        entryCount: entries.length,
        urlCount: uniqueUrls.length,
        durationMs: Date.now() - startedAt,
      },
      "Sitemap scan finished",
    );
    return uniqueUrls;
  }

  private resolveFetchSettings(): SitemapFetchResolved {
    if (process.env.VITEST === "true") {
      const o = this.config.fetch;
      return {
        initialDelayMs: o?.initialDelayMs ?? VITEST_FETCH.initialDelayMs,
        retries: o?.retries ?? VITEST_FETCH.retries,
        baseDelayMs: o?.baseDelayMs ?? VITEST_FETCH.baseDelayMs,
        maxDelayMs: o?.maxDelayMs ?? VITEST_FETCH.maxDelayMs,
        timeoutMs: o?.timeoutMs ?? VITEST_FETCH.timeoutMs,
        userAgent: o?.userAgent ?? DEFAULT_BROWSER_HEADERS["User-Agent"],
        referer: o?.referer,
      };
    }

    const o = this.config.fetch;
    const d = PRODUCTION_FETCH_DEFAULTS;

    return {
      initialDelayMs: o?.initialDelayMs ?? d.initialDelayMs,
      retries: o?.retries ?? d.retries,
      baseDelayMs: o?.baseDelayMs ?? d.baseDelayMs,
      maxDelayMs: o?.maxDelayMs ?? d.maxDelayMs,
      timeoutMs: o?.timeoutMs ?? d.timeoutMs,
      userAgent: o?.userAgent ?? DEFAULT_BROWSER_HEADERS["User-Agent"],
      referer: o?.referer,
    };
  }

  private getHttpEntryUrls(): string[] {
    const children = this.config.childSitemapUrls;
    if (children != null && children.length > 0) {
      return children;
    }
    const single = this.config.url;
    if (single != null && single.length > 0) {
      return [single];
    }
    throw new ScanAbortError(
      "No sitemap URLs configured (need sitemap.url, or sitemap.childSitemapUrls for HTTP).",
    );
  }

  private async fetchXml(url: string, fetch: SitemapFetchResolved): Promise<string> {
    const headers: Record<string, string> = {
      "User-Agent": fetch.userAgent,
      Accept: DEFAULT_BROWSER_HEADERS.Accept,
      "Accept-Encoding": DEFAULT_BROWSER_HEADERS["Accept-Encoding"],
    };
    if (fetch.referer != null && fetch.referer.length > 0) {
      headers.Referer = fetch.referer;
    }

    const response = await axios.get(url, {
      timeout: fetch.timeoutMs,
      headers,
      responseType: "text",
    });

    return typeof response.data === "string" ? response.data : String(response.data);
  }

  private async fetchXmlWithRetry(url: string, fetch: SitemapFetchResolved): Promise<string> {
    return withRetry(() => this.fetchXml(url, fetch), {
      retries: fetch.retries,
      delayMs: fetch.baseDelayMs,
      maxDelayMs: fetch.maxDelayMs,
      shouldRetry: (error) => this.shouldRetry(error),
      resolveDelayMs: (error, computedBackoffMs) =>
        this.resolveDelayForRetry(error, computedBackoffMs),
      onRetry: (error, attempt, computedDelayMs, waitMs) => {
        const retryAfterMs = this.getRetryAfterMs(error);
        logger.warn(
          {
            url,
            attempt,
            computedDelayMs,
            waitMs,
            retryAfterMs,
            error: this.formatError(error),
          },
          "Sitemap fetch retry scheduled",
        );
      },
    });
  }

  private resolveDelayForRetry(error: unknown, computedBackoffMs: number): number {
    const retryAfterMs = this.getRetryAfterMs(error);
    if (retryAfterMs != null) {
      return Math.max(computedBackoffMs, retryAfterMs);
    }
    return computedBackoffMs;
  }

  private isEnotfound(error: unknown): boolean {
    if (!this.isObject(error)) {
      return false;
    }
    return this.getString(error, "code") === "ENOTFOUND";
  }

  private getRetryAfterMs(error: unknown): number | undefined {
    if (!axios.isAxiosError(error) || !error.response?.headers) {
      return undefined;
    }
    const headers = error.response.headers as Record<string, unknown> & {
      get?: (name: string) => string | undefined;
    };
    const raw =
      typeof headers.get === "function"
        ? headers.get("retry-after") ?? headers.get("Retry-After")
        : (headers["retry-after"] ?? headers["Retry-After"]) as string | undefined;
    if (raw == null || raw === "") {
      return undefined;
    }
    const trimmed = raw.trim();
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
      return asNumber * 1000;
    }
    const target = Date.parse(trimmed);
    if (!Number.isFinite(target)) {
      return undefined;
    }
    return Math.max(0, target - Date.now());
  }

  private detectType(parsed: XmlNode): SitemapType {
    if (parsed.sitemapindex) {
      return "index";
    }

    if (parsed.urlset) {
      return "urlset";
    }

    return "unknown";
  }

  /**
   * @param localAnchorPath When set (file strategy), try sibling files on disk before HTTP.
   */
  private async handleSitemapIndex(
    parsed: XmlNode,
    fetch: SitemapFetchResolved,
    gapMs: number,
    localAnchorPath?: string,
  ): Promise<string[]> {
    const sitemapIndex = parsed.sitemapindex as XmlNode | undefined;
    const children = this.toArray(sitemapIndex?.sitemap as XmlNode | XmlNode[] | undefined)
      .map((entry) => entry.loc)
      .filter((loc): loc is string => typeof loc === "string" && loc.trim().length > 0);

    logger.info({ childCount: children.length }, "Sitemap index child count found");

    let resolvedCount = 0;
    const allUrls: string[] = [];
    let isFirstChild = true;

    for (const childUrl of children) {
      if (!isFirstChild) {
        await sleep(gapMs);
      }
      isFirstChild = false;

      try {
        logger.info({ childUrl }, "Child sitemap fetch start");
        const childXml = await this.resolveChildSitemapXml(childUrl, fetch, localAnchorPath);
        const childParsed = this.parser.parse(childXml) as XmlNode;
        const childType = this.detectType(childParsed);
        if (childType !== "urlset") {
          logger.warn({ childUrl, childType }, "Child sitemap did not return urlset");
          continue;
        }
        resolvedCount += 1;
        allUrls.push(...this.handleUrlSet(childParsed));
      } catch (error) {
        if (this.isEnotfound(error)) {
          throw new ScanAbortError(
            `DNS resolution failed for ${childUrl}. Check network connectivity and VPN status.`,
            error,
          );
        }
        logger.warn({ childUrl, error: this.formatError(error) }, "Child sitemap fetch failed");
      }
    }

    logger.info(`${resolvedCount} of ${children.length} child sitemaps resolved`);

    return allUrls;
  }

  /** Local sibling file (same directory as anchor) matching child URL basename, else HTTP. */
  private async resolveChildSitemapXml(
    childUrl: string,
    fetch: SitemapFetchResolved,
    localAnchorPath?: string,
  ): Promise<string> {
    if (localAnchorPath != null) {
      const candidate = this.siblingLocalPath(localAnchorPath, childUrl);
      if (candidate != null && existsSync(candidate)) {
        try {
          return readFileSync(candidate, "utf8");
        } catch (error) {
          logger.warn({ candidate, error: this.formatError(error) }, "Failed to read local child sitemap");
        }
      }
    }
    return this.fetchXmlWithRetry(childUrl, fetch);
  }

  private siblingLocalPath(anchorFilePath: string, childUrl: string): string | null {
    try {
      const pathName = new URL(childUrl).pathname;
      const name = basename(pathName);
      if (name.length === 0 || name === "/") {
        return null;
      }
      return join(dirname(anchorFilePath), name);
    } catch {
      return null;
    }
  }

  private handleUrlSet(parsed: XmlNode): string[] {
    const urlset = parsed.urlset as XmlNode | undefined;
    const urlEntries = this.toArray(urlset?.url as XmlNode | XmlNode[] | undefined);

    return urlEntries
      .map((entry) => entry.loc)
      .filter((loc): loc is string => typeof loc === "string" && loc.trim().length > 0)
      .map((loc) =>
        normalizeUrlWithLocale(loc, {
          stripLocale: this.config.stripLocale,
          locales: this.config.locales,
        }),
      );
  }

  private toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  private shouldRetry(error: unknown): boolean {
    if (!this.isObject(error)) {
      return false;
    }

    const code = this.getString(error, "code");
    if (code === "ENOTFOUND") {
      return false;
    }
    if (code === "ETIMEDOUT" || code === "ECONNRESET") {
      return true;
    }

    if (axios.isAxiosError(error) && error.response?.status != null) {
      const status = error.response.status;
      if (NON_RETRYABLE_STATUS_CODES.has(status)) {
        return false;
      }
      return RETRYABLE_STATUS_CODES.has(status);
    }

    const response = this.getObject(error, "response");
    const status = response ? this.getNumber(response, "status") : undefined;
    if (status !== undefined) {
      if (NON_RETRYABLE_STATUS_CODES.has(status)) {
        return false;
      }
      return RETRYABLE_STATUS_CODES.has(status);
    }

    return false;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private getObject(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
    const value = obj[key];
    return this.isObject(value) ? value : null;
  }

  private getString(obj: Record<string, unknown>, key: string): string | undefined {
    const value = obj[key];
    return typeof value === "string" ? value : undefined;
  }

  private getNumber(obj: Record<string, unknown>, key: string): number | undefined {
    const value = obj[key];
    return typeof value === "number" ? value : undefined;
  }
}
