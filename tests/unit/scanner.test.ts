import { describe, expect, it, vi } from "vitest";

import { scanSection } from "../../src/core/scanner";
import type { UrlSource } from "../../src/types/connector.types";
import type { SectionConfig } from "../../src/types/config.types";

function section(overrides: Partial<SectionConfig> = {}): SectionConfig {
  return {
    name: "Insights",
    widgetId: "w",
    sources: ["1"],
    urlPatterns: ["/insights/blogs", "/insights/articles"],
    subtypeField: "type",
    urlField: "url",
    entity: "content",
    locale: { country: "us", language: "en" },
    ...overrides,
  };
}

describe("scanSection urlPatterns filter", () => {
  it("compare only sees URLs matching the section patterns", async () => {
    const allSitemap = [
      "https://x.com/insights/blogs/a",
      "https://x.com/news-and-events/events/b",
      "https://x.com/insights/articles/c",
    ];
    const sitemapSource: UrlSource = {
      getUrls: vi.fn().mockResolvedValue(allSitemap),
    };

    const indexedSource: UrlSource = {
      getUrls: vi.fn().mockResolvedValue([
        "https://x.com/insights/blogs/a",
        "https://x.com/insights/articles/c",
      ]),
    };

    const result = await scanSection({
      section: section(),
      sitemapSource,
      indexedSource,
    });

    expect(sitemapSource.getUrls).toHaveBeenCalledTimes(1);
    expect(indexedSource.getUrls).toHaveBeenCalledTimes(1);
    expect(result.expectedCount).toBe(2);
    expect(result.indexedCount).toBe(2);
    expect(result.coveragePercent).toBe(100);
  });

  it("different section excludes non-matching sitemap URLs", async () => {
    const sitemapSource: UrlSource = {
      getUrls: vi.fn().mockResolvedValue(["https://x.com/news-and-events/events/only"]),
    };
    const indexedSource: UrlSource = {
      getUrls: vi.fn().mockResolvedValue(["https://x.com/news-and-events/events/only"]),
    };

    const insights = await scanSection({
      section: section({ name: "Insights", urlPatterns: ["/insights/blogs"] }),
      sitemapSource,
      indexedSource,
    });

    expect(insights.expectedCount).toBe(0);
    expect(insights.coveragePercent).toBe(100);
  });
});
