import { describe, expect, it } from "vitest";

import { compareUrls } from "../../src/core/compare";
import type { SectionConfig } from "../../src/types/config.types";

const insightsSection: SectionConfig = {
  name: "Insights",
  widgetId: "rfkid_example_search",
  sources: ["1111111", "2222222"],
  urlPatterns: ["/insights/blogs", "/insights/articles", "/insights/podcasts"],
  subtypeField: "type",
  urlField: "url",
  entity: "content",
  locale: {
    country: "us",
    language: "en",
  },
};

describe("compare", () => {
  it("Perfect coverage -> 100%", () => {
    const expected = new Set([
      "https://www.example.com/insights/blogs/a",
      "https://www.example.com/insights/articles/b",
    ]);
    const indexed = new Set(expected);

    const result = compareUrls(expected, indexed, [], insightsSection);
    expect(result.coveragePercent).toBe(100);
    expect(result.missingUrls).toEqual([]);
  });

  it("Zero coverage -> 0%, all in missingUrls", () => {
    const expected = new Set([
      "https://www.example.com/insights/blogs/a",
      "https://www.example.com/insights/articles/b",
    ]);
    const indexed = new Set<string>();

    const result = compareUrls(expected, indexed, [], insightsSection);
    expect(result.coveragePercent).toBe(0);
    expect(result.missingUrls).toHaveLength(2);
    expect(result.missingUrls.sort()).toEqual(["/insights/articles/b", "/insights/blogs/a"]);
  });

  it("300 of 3000 indexed -> 10% coverage with 2700 missing", () => {
    const expected = new Set(
      Array.from({ length: 3000 }, (_, i) => `https://www.example.com/insights/blogs/post-${i}`),
    );
    const indexed = new Set(
      Array.from({ length: 300 }, (_, i) => `https://www.example.com/insights/blogs/post-${i}`),
    );

    const result = compareUrls(expected, indexed, [], insightsSection);
    expect(result.coveragePercent).toBe(10);
    expect(result.missingUrls).toHaveLength(2700);
  });

  it("bySubtype correctly groups URLs by pattern prefix", () => {
    const expected = new Set([
      "https://www.example.com/insights/blogs/a",
      "https://www.example.com/insights/blogs/b",
      "https://www.example.com/insights/articles/c",
    ]);
    const indexed = new Set([
      "https://www.example.com/insights/blogs/a",
      "https://www.example.com/insights/articles/c",
    ]);

    const result = compareUrls(expected, indexed, [], insightsSection);
    expect(result.bySubtype.Blogs.expectedCount).toBe(2);
    expect(result.bySubtype.Blogs.matchedCount).toBe(1);
    expect(result.bySubtype.Articles.expectedCount).toBe(1);
    expect(result.bySubtype.Articles.matchedCount).toBe(1);
  });

  it("Subtype with 0 indexed -> subtype coverage 0%", () => {
    const expected = new Set(["https://www.example.com/insights/podcasts/episode-1"]);
    const indexed = new Set<string>();

    const result = compareUrls(expected, indexed, [], insightsSection);
    expect(result.bySubtype.Podcasts.coveragePercent).toBe(0);
    expect(result.bySubtype.Podcasts.indexedCount).toBe(0);
  });

  it("Unexpected URLs correctly identified", () => {
    const expected = new Set(["https://www.example.com/insights/blogs/a"]);
    const indexed = new Set([
      "https://www.example.com/insights/blogs/a",
      "https://www.example.com/insights/blogs/unexpected",
    ]);

    const result = compareUrls(expected, indexed, [], insightsSection);
    expect(result.unexpectedUrls).toEqual(["/insights/blogs/unexpected"]);
  });

  it("matches indexed path-only to sitemap full URL (same pathname)", () => {
    const expected = new Set(["https://WWW.example.com/insights/blogs/post-a"]);
    const indexed = new Set(["/insights/blogs/post-a"]);
    const result = compareUrls(expected, indexed, [], insightsSection);
    expect(result.coveragePercent).toBe(100);
    expect(result.matchedCount).toBe(1);
  });

  it("matches different origins when pathname is the same", () => {
    const expected = new Set(["https://www.example.com/insights/blogs/item"]);
    const indexed = new Set(["https://qa-www.example.com/insights/blogs/item"]);
    const result = compareUrls(expected, indexed, [], insightsSection);
    expect(result.coveragePercent).toBe(100);
  });

  it("counts sitemap hub URL covered when only deeper indexed URLs exist", () => {
    const expected = new Set(["https://www.example.com/insights/articles"]);
    const indexed = new Set(["https://www.example.com/insights/articles/some-post"]);
    const result = compareUrls(expected, indexed, [], insightsSection);
    expect(result.missingUrls).toEqual([]);
    expect(result.coveragePercent).toBe(100);
    expect(result.matchedCount).toBe(1);
  });

  it("does not treat sibling people URLs as covering each other", () => {
    const peopleSection = { ...insightsSection, name: "People" };
    const expected = new Set(["https://www.example.com/people/luis-abreu"]);
    const indexed = new Set(["https://www.example.com/people/cyrus-abbassi"]);
    const result = compareUrls(expected, indexed, [], peopleSection);
    expect(result.missingUrls).toEqual(["/people/luis-abreu"]);
    expect(result.coveragePercent).toBe(0);
  });

  it("Both empty -> 100%", () => {
    const result = compareUrls(new Set(), new Set(), [], insightsSection);
    expect(result.coveragePercent).toBe(100);
    expect(result.missingUrls).toEqual([]);
    expect(result.unexpectedUrls).toEqual([]);
  });
});
