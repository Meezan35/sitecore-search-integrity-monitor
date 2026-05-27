import axios, { AxiosError } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScanAbortError } from "../../src/errors/scan-abort-error";
import {
  DISCOVER_API_MAX_PAGE_LIMIT,
  SitecoreSearchConnector,
} from "../../src/connectors/sitecore-search.connector";
import type { ScanTargetConfig, SectionConfig } from "../../src/types/config.types";
import { logger } from "../../src/utils/logger";

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      post: vi.fn(),
    },
  };
});

const mockedAxios = vi.mocked(axios, true);
const API_URL = "https://discover.sitecorecloud.io/discover/v2/99999999999";

function extractSearch(payload: Record<string, unknown>): { offset: number; limit: number } {
  const search = (payload.widget as { items: Array<{ search: { offset?: number; limit?: number } }> })
    .items[0].search;
  return {
    offset: typeof search.offset === "number" ? search.offset : 0,
    limit: typeof search.limit === "number" ? search.limit : DISCOVER_API_MAX_PAGE_LIMIT,
  };
}

function createSearchConfig(pageSize = 500): ScanTargetConfig["search"] {
  return {
    apiUrl: API_URL,
    apiKey: "01-test-key",
    pageSize,
    sections: [],
  };
}

function createSection(overrides: Partial<SectionConfig> = {}): SectionConfig {
  return {
    name: "Insights",
    widgetId: "rfkid_example_search",
    sources: ["1111111", "2222222"],
    urlPatterns: ["/insights/blogs"],
    subtypeField: "type",
    urlField: "url",
    entity: "content",
    locale: {
      country: "us",
      language: "en",
    },
    ...overrides,
  };
}

function makeContent(prefix: string, start: number, count: number): Array<{ id: string; url: string; type: string }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${start + index}`,
    url: `https://www.example.com/${prefix}/${start + index}`,
    type: "content",
  }));
}

describe("SitecoreSearchConnector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Insights: paginates with Discover max limit 100 and returns all URLs", async () => {
    mockedAxios.post.mockImplementation(async (_url: string, payload: Record<string, unknown>) => {
      const { offset, limit } = extractSearch(payload);
      expect(limit).toBeLessThanOrEqual(DISCOVER_API_MAX_PAGE_LIMIT);
      const total = 1200;
      const count = Math.min(limit, Math.max(0, total - offset));
      return { data: { widgets: [{ total_item: total, content: makeContent("insights", offset, count) }] } };
    });

    const connector = new SitecoreSearchConnector(createSearchConfig(500), createSection());
    const result = await connector.getUrls();

    expect(result).toHaveLength(1200);
    expect(mockedAxios.post).toHaveBeenCalledTimes(12);
  });

  it("People: total_item=850 omits query from payload", async () => {
    const section = createSection({
      name: "People",
      widgetId: "rfkid_example_people",
      sources: ["1111111", "2222222"],
      urlPatterns: ["/people"],
    });

    mockedAxios.post.mockImplementation(async (_url: string, payload: Record<string, unknown>) => {
      const { offset, limit } = extractSearch(payload);
      const total = 850;
      const count = Math.min(limit, Math.max(0, total - offset));
      return { data: { widgets: [{ total_item: total, content: makeContent("people", offset, count) }] } };
    });

    const connector = new SitecoreSearchConnector(createSearchConfig(500), section);
    const result = await connector.getUrls();

    expect(result).toHaveLength(850);
    const firstPayload = mockedAxios.post.mock.calls[0]?.[1] as {
      widget: { items: Array<{ search: Record<string, unknown> }> };
    };
    expect(firstPayload.widget.items[0].search.query).toBeUndefined();
  });

  it("News & Events: total_item=0 returns empty set and warns", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const section = createSection({
      name: "News & Events",
      sources: ["1111111", "2222222"],
    });
    mockedAxios.post.mockResolvedValue({ data: { widgets: [{ total_item: 0, content: [] }] } });

    const connector = new SitecoreSearchConnector(createSearchConfig(500), section);
    const result = await connector.getUrls();

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "Search returned 0 results. Check widgetId, sources, apiKey.",
    );
  });

  it("logs CRITICAL warning when collected is below 80% of total_item", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    mockedAxios.post.mockImplementation(async (_url: string, payload: Record<string, unknown>) => {
      const { offset, limit } = extractSearch(payload);
      const total = 1000;
      if (offset >= 700) {
        return { data: { widgets: [{ total_item: total, content: [] }] } };
      }
      const count = Math.min(limit, Math.max(0, total - offset));
      return { data: { widgets: [{ total_item: total, content: makeContent("insights", offset, count) }] } };
    });

    const connector = new SitecoreSearchConnector(createSearchConfig(500), createSection());
    const result = await connector.getUrls();

    expect(result).toHaveLength(700);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        collectedCount: 700,
        totalItem: 1000,
      }),
      "CRITICAL: collected results are below 80% of total_item",
    );
  });

  it("retries page fetch on 429 and still returns full results", async () => {
    let failedOnceAt100 = false;
    mockedAxios.post.mockImplementation(async (_url: string, payload: Record<string, unknown>) => {
      const { offset, limit } = extractSearch(payload);
      const total = 1000;
      if (offset === 100 && !failedOnceAt100) {
        failedOnceAt100 = true;
        throw new AxiosError(
          "Too many requests",
          "ERR_BAD_REQUEST",
          undefined,
          undefined,
          {
            status: 429,
            statusText: "Too Many Requests",
            data: {},
            headers: {},
            config: {} as never,
          },
        );
      }
      const count = Math.min(limit, Math.max(0, total - offset));
      return { data: { widgets: [{ total_item: total, content: makeContent("insights", offset, count) }] } };
    });

    const connector = new SitecoreSearchConnector(createSearchConfig(500), createSection());
    const result = await connector.getUrls();

    expect(result).toHaveLength(1000);
    expect(failedOnceAt100).toBe(true);
  });

  it("throws ScanAbortError when total_item is missing", async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        widgets: [
          {
            content: [],
          },
        ],
      },
    });

    const connector = new SitecoreSearchConnector(createSearchConfig(500), createSection());

    await expect(connector.getUrls()).rejects.toBeInstanceOf(ScanAbortError);
    await expect(connector.getUrls()).rejects.toThrow("total_item field missing from API response");
  });

  it("skips null/empty urls and returns only valid normalized URLs", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => logger);
    mockedAxios.post.mockResolvedValue({
      data: {
        widgets: [
          {
            total_item: 4,
            content: [
              { id: "1", url: "https://www.example.com/insights/blogs/1", type: "content" },
              { id: "2", url: null, type: "content" },
              { id: "3", url: "", type: "content" },
              { id: "4", url: " https://www.example.com/insights/blogs/4 ", type: "content" },
            ],
          },
        ],
      },
    });

    const connector = new SitecoreSearchConnector(createSearchConfig(500), createSection());
    const result = await connector.getUrls();

    expect(result).toEqual(["/insights/blogs/1", "/insights/blogs/4"]);
    expect(debugSpy).toHaveBeenCalled();
  });

  it("verifies People payload does not include query.keyphrase field", async () => {
    const section = createSection({
      name: "People",
      widgetId: "rfkid_example_people",
      sources: ["1111111", "2222222"],
      urlPatterns: ["/people"],
    });

    mockedAxios.post.mockResolvedValue({
      data: {
        widgets: [
          {
            total_item: 1,
            content: [{ id: "person-1", url: "https://www.example.com/people/person-1", type: "content" }],
          },
        ],
      },
    });

    const connector = new SitecoreSearchConnector(createSearchConfig(500), section);
    await connector.getUrls();

    const payload = mockedAxios.post.mock.calls[0]?.[1] as {
      widget: { items: Array<{ search: Record<string, unknown> }> };
    };
    expect(payload.widget.items[0].search.query).toBeUndefined();
  });
});
