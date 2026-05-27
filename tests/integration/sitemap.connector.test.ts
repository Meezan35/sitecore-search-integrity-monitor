import axios, { AxiosError } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScanAbortError } from "../../src/errors/scan-abort-error";
import { SitemapConnector } from "../../src/connectors/sitemap.connector";
import { logger } from "../../src/utils/logger";

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      get: vi.fn(),
    },
  };
});

const mockedAxios = vi.mocked(axios, true);

const INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex>
  <sitemap><loc>https://www.example.com/sitemap-1.xml</loc></sitemap>
  <sitemap><loc>https://www.example.com/sitemap-2.xml</loc></sitemap>
  <sitemap><loc>https://www.example.com/sitemap-3.xml</loc></sitemap>
</sitemapindex>`;

const INDEX_XML_SINGLE_CHILD = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex>
  <sitemap><loc>https://www.example.com/sitemap-1.xml</loc></sitemap>
</sitemapindex>`;

const URLSET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://www.example.com/insights/blogs/post-1</loc></url>
  <url><loc>https://www.example.com/people/jane-doe</loc></url>
</urlset>`;

const URLSET_XML_SINGLE_URL = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://www.example.com/news-and-events/press-releases/title</loc></url>
</urlset>`;

function createConnector(): SitemapConnector {
  return new SitemapConnector({
    url: "https://www.example.com/sitemap.xml",
    fetchStrategy: "http",
    stripLocale: false,
    locales: ["en"],
    delayBetweenRequestsMs: 0,
  });
}

describe("SitemapConnector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches childSitemapUrls when set and does not request sitemap url", async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      expect(url).not.toBe("https://www.example.com/sitemap.xml");
      if (url === "https://www.example.com/sitemap-1.xml") {
        return {
          data: `<?xml version="1.0"?><urlset><url><loc>https://www.example.com/a</loc></url></urlset>`,
        };
      }
      return {
        data: `<?xml version="1.0"?><urlset><url><loc>https://www.example.com/b</loc></url></urlset>`,
      };
    });

    const connector = new SitemapConnector({
      url: "https://www.example.com/sitemap.xml",
      fetchStrategy: "http",
      childSitemapUrls: [
        "https://www.example.com/sitemap-1.xml",
        "https://www.example.com/sitemap-2.xml",
      ],
      stripLocale: false,
      locales: ["en"],
      delayBetweenRequestsMs: 0,
    });
    const result = await connector.getUrls();
    expect(result).toEqual(["https://www.example.com/a", "https://www.example.com/b"]);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it("returns combined URLs when root is sitemap index with 3 children", async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === "https://www.example.com/sitemap.xml") {
        return { data: INDEX_XML };
      }
      if (url === "https://www.example.com/sitemap-1.xml") {
        return {
          data: `<?xml version="1.0"?><urlset><url><loc>https://www.example.com/insights/blogs/a</loc></url></urlset>`,
        };
      }
      if (url === "https://www.example.com/sitemap-2.xml") {
        return {
          data: `<?xml version="1.0"?><urlset><url><loc>https://www.example.com/people/attorney-name</loc></url></urlset>`,
        };
      }
      return {
        data: `<?xml version="1.0"?><urlset><url><loc>https://www.example.com/news-and-events/press-releases/title</loc></url></urlset>`,
      };
    });

    const connector = createConnector();
    const result = await connector.getUrls();
    expect(result).toEqual([
      "https://www.example.com/insights/blogs/a",
      "https://www.example.com/people/attorney-name",
      "https://www.example.com/news-and-events/press-releases/title",
    ]);
  });

  it("returns URLs directly when root is a flat urlset", async () => {
    mockedAxios.get.mockResolvedValue({ data: URLSET_XML });

    const connector = createConnector();
    const result = await connector.getUrls();

    expect(result).toEqual([
      "https://www.example.com/insights/blogs/post-1",
      "https://www.example.com/people/jane-doe",
    ]);
  });

  it("continues collecting when one child fails and logs warning", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === "https://www.example.com/sitemap.xml") {
        return { data: INDEX_XML };
      }
      if (url === "https://www.example.com/sitemap-2.xml") {
        const error = new Error("Not found") as Error & {
          response?: { status: number };
        };
        error.response = { status: 404 };
        throw error;
      }
      return {
        data: `<?xml version="1.0"?><urlset><url><loc>${url.replace(".xml", "/ok")}</loc></url></urlset>`,
      };
    });

    const connector = createConnector();
    const result = await connector.getUrls();

    expect(result).toEqual([
      "https://www.example.com/sitemap-1/ok",
      "https://www.example.com/sitemap-3/ok",
    ]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("handles sitemap index where sitemap node is a single object", async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === "https://www.example.com/sitemap.xml") {
        return { data: INDEX_XML_SINGLE_CHILD };
      }
      return {
        data: `<?xml version="1.0"?><urlset><url><loc>https://www.example.com/insights/articles/single-child</loc></url></urlset>`,
      };
    });

    const connector = createConnector();
    const result = await connector.getUrls();
    expect(result).toEqual(["https://www.example.com/insights/articles/single-child"]);
  });

  it("handles urlset where url node is a single object", async () => {
    mockedAxios.get.mockResolvedValue({ data: URLSET_XML_SINGLE_URL });

    const connector = createConnector();
    const result = await connector.getUrls();
    expect(result).toEqual(["https://www.example.com/news-and-events/press-releases/title"]);
  });

  it("throws ScanAbortError when root fetch fails after retries are exhausted", async () => {
    mockedAxios.get.mockRejectedValue(
      new AxiosError(
        "Service unavailable",
        "ERR_BAD_RESPONSE",
        undefined,
        undefined,
        {
          status: 503,
          statusText: "Service Unavailable",
          data: {},
          headers: {},
          config: {} as never,
        },
      ),
    );

    const connector = createConnector();

    await expect(connector.getUrls()).rejects.toBeInstanceOf(ScanAbortError);
    expect(mockedAxios.get).toHaveBeenCalledTimes(4);
  });
});
