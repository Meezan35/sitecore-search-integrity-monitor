import axios from "axios";
import { z } from "zod";

import { ScanAbortError } from "../errors/scan-abort-error";
import { normalizeUrl } from "../core/normalize";
import type { UrlSource } from "../types/connector.types";
import type { ScanTargetConfig, SectionConfig } from "../types/config.types";
import { pLimit } from "../utils/concurrency";
import { logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);
const PAGE_CONCURRENCY = 3;
/** Sitecore Discover v2 rejects `search.limit` above this value (API returns validation error 102). */
export const DISCOVER_API_MAX_PAGE_LIMIT = 100;

const SearchResultSchema = z.object({
  url: z.string().nullish(),
  type: z.string().nullish(),
  id: z.string(),
});

const SearchResponseSchema = z.object({
  widgets: z.array(
    z.object({
      total_item: z.number(),
      content: z.array(SearchResultSchema),
    }),
  ),
});

type SearchResult = z.infer<typeof SearchResultSchema>;
type SearchResponse = z.infer<typeof SearchResponseSchema>;

export class SitecoreSearchConnector implements UrlSource {
  constructor(
    private readonly config: ScanTargetConfig["search"],
    private readonly section: SectionConfig,
  ) {}

  async getUrls(): Promise<string[]> {
    const startedAt = Date.now();
    const requestedPageSize = this.config.pageSize;
    const pageSize = Math.min(requestedPageSize, DISCOVER_API_MAX_PAGE_LIMIT);

    if (requestedPageSize > DISCOVER_API_MAX_PAGE_LIMIT) {
      logger.info(
        {
          sectionName: this.section.name,
          requestedPageSize,
          effectivePageSize: pageSize,
          maxAllowed: DISCOVER_API_MAX_PAGE_LIMIT,
        },
        "Discover API max page size applied (limit attribute cannot exceed 100)",
      );
    }

    logger.info(
      {
        sectionName: this.section.name,
        widgetId: this.section.widgetId,
        sources: this.section.sources,
        pageSize,
      },
      "Starting Sitecore Search fetch",
    );

    const firstPage = await this.fetchPageWithRetry(0, pageSize);
    const firstWidget = firstPage.widgets[0];

    if (typeof firstWidget?.total_item !== "number") {
      throw new ScanAbortError("total_item field missing from API response");
    }

    const totalItems = firstWidget.total_item;
    logger.info(
      { sectionName: this.section.name, totalItem: totalItems },
      "Sitecore Search page 1 fetched",
    );

    if (totalItems === 0) {
      logger.warn("Search returned 0 results. Check widgetId, sources, apiKey.");
      return [];
    }

    const offsets: number[] = [];
    for (let offset = pageSize; offset < totalItems; offset += pageSize) {
      offsets.push(offset);
    }

    const pageTasks = offsets.map(
      (offset) => async (): Promise<SearchResult[]> => this.fetchPageContent(offset, pageSize),
    );
    const remainingPages = await pLimit(pageTasks, PAGE_CONCURRENCY);

    const collectedResults = [firstWidget.content, ...remainingPages].flat();
    const collectedCount = collectedResults.length;

    if (collectedCount < totalItems * 0.8) {
      logger.warn(
        {
          sectionName: this.section.name,
          collectedCount,
          totalItem: totalItems,
        },
        "CRITICAL: collected results are below 80% of total_item",
      );
    }

    const normalizedUrls = new Set<string>();
    collectedResults.forEach((result) => {
      if (!result.url || result.url.trim().length === 0) {
        logger.debug({ resultId: result.id }, "Skipping result with null/empty url");
        return;
      }
      normalizedUrls.add(normalizeUrl(result.url));
    });

    logger.info(
      {
        sectionName: this.section.name,
        collectedCount,
        totalItem: totalItems,
        durationMs: Date.now() - startedAt,
      },
      "Sitecore Search fetch completed",
    );

    return [...normalizedUrls];
  }

  private async fetchPageContent(offset: number, limit: number): Promise<SearchResult[]> {
    const page = await this.fetchPageWithRetry(offset, limit);
    return page.widgets[0]?.content ?? [];
  }

  private async fetchPageWithRetry(offset: number, limit: number): Promise<SearchResponse> {
    return withRetry(() => this.fetchPage(offset, limit), {
      retries: 3,
      delayMs: 250,
      maxDelayMs: 10_000,
      shouldRetry: (error) => this.shouldRetry(error),
      onRetry: (error, attempt, computedDelayMs, waitMs) => {
        logger.warn(
          {
            sectionName: this.section.name,
            offset,
            limit,
            attempt,
            computedDelayMs,
            waitMs,
            error: this.formatError(error),
          },
          "Search page retry scheduled",
        );
      },
    });
  }

  private async fetchPage(offset: number, limit: number): Promise<SearchResponse> {
    logger.info({ sectionName: this.section.name, offset, limit }, "Fetching search page");
    const payload = this.buildPayload(offset, limit);

    let response;
    try {
      response = await axios.post(this.config.apiUrl, payload, {
        timeout: 10_000,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        const body = error.response.data;
        const logPayload = {
          sectionName: this.section.name,
          offset,
          limit,
          status,
          responseBody: body,
        };
        if (RETRYABLE_STATUS_CODES.has(status)) {
          logger.warn(logPayload, "Sitecore Search API request failed (may retry)");
        } else {
          logger.error(logPayload, "Sitecore Search API request failed");
        }
        if (RETRYABLE_STATUS_CODES.has(status)) {
          throw error;
        }
        if (status === 400 || status === 401 || status === 403) {
          const hint =
            " Use the full API key from Sitecore Discover as Bearer (typically starts with 01-), not the numeric account ID in the apiUrl path.";
          throw new Error(
            `Sitecore Search HTTP ${status} at offset ${offset}: ${formatResponseBodyForError(body)}${hint}`,
          );
        }
      }
      throw error;
    }

    const firstWidget = this.tryGetFirstWidget(response.data);
    if (firstWidget && !Object.prototype.hasOwnProperty.call(firstWidget, "total_item")) {
      throw new ScanAbortError("total_item field missing from API response");
    }

    const parsed = SearchResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      logger.error(
        { sectionName: this.section.name, rawShape: response.data },
        "Invalid Sitecore Search response schema",
      );
      throw new Error(
        `Invalid Sitecore Search response at offset ${offset}: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    return parsed.data;
  }

  private tryGetFirstWidget(value: unknown): Record<string, unknown> | null {
    if (!this.isObject(value)) {
      return null;
    }
    const widgets = value.widgets;
    if (!Array.isArray(widgets) || widgets.length === 0) {
      return null;
    }
    return this.isObject(widgets[0]) ? widgets[0] : null;
  }

  private buildPayload(offset: number, limit: number): Record<string, unknown> {
    const search: Record<string, unknown> = {
      content: {},
      limit,
      offset,
    };

    if (!this.isPeopleSection()) {
      search.query = {
        keyphrase: " ",
      };
    }

    return {
      widget: {
        items: [
          {
            rfk_id: this.section.widgetId,
            entity: this.section.entity,
            search,
            sources: this.section.sources,
          },
        ],
      },
      context: {
        locale: this.section.locale,
      },
    };
  }

  private isPeopleSection(): boolean {
    return this.section.name.trim().toLowerCase() === "people";
  }

  private shouldRetry(error: unknown): boolean {
    if (!this.isObject(error)) {
      return false;
    }

    const code = this.getString(error, "code");
    if (code === "ETIMEDOUT" || code === "ECONNRESET") {
      return true;
    }

    const status = getHttpStatusFromErrorLike(error);
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

function getHttpStatusFromErrorLike(error: Record<string, unknown>): number | undefined {
  const response = error.response;
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const status = (response as Record<string, unknown>).status;
  return typeof status === "number" ? status : undefined;
}

function formatResponseBodyForError(body: unknown): string {
  if (body === undefined || body === null || body === "") {
    return "(empty response body)";
  }
  if (typeof body === "string") {
    return body.slice(0, 2000);
  }
  try {
    return JSON.stringify(body).slice(0, 2000);
  } catch {
    return String(body);
  }
}
