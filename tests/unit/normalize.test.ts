import { describe, expect, it } from "vitest";

import {
  matchesPattern,
  normalizeUrl,
  normalizeUrlPattern,
  normalizeUrls,
  buildIndexedAncestorCoverSet,
} from "../../src/core/normalize";

describe("normalize", () => {
  it("strips domain and returns pathname only", () => {
    expect(normalizeUrl(" https://www.example.com/insights/blogs/post-a ")).toBe("/insights/blogs/post-a");
    expect(normalizeUrl("HTTPS://WWW.EXAMPLE.COM/PATH")).toBe("/path");
  });

  it("treats different hosts with same path as equal pathname", () => {
    expect(normalizeUrl("https://www.example.com/insights/blogs/x")).toBe("/insights/blogs/x");
    expect(normalizeUrl("https://qa-www.example.com/insights/blogs/x")).toBe("/insights/blogs/x");
  });

  it("lowercases path and strips trailing slashes", () => {
    expect(normalizeUrl("https://x.com/Foo/Bar/")).toBe("/foo/bar");
    expect(normalizeUrl("/insights/Blogs/Z/")).toBe("/insights/blogs/z");
  });

  it("drops query strings and hashes", () => {
    expect(normalizeUrl("https://x.com/path?a=1&b=2")).toBe("/path");
    expect(normalizeUrl("https://x.com/other#frag")).toBe("/other");
  });

  it("handles path-only input", () => {
    expect(normalizeUrl("/people/jane")).toBe("/people/jane");
  });

  it("normalizeUrl decodes percent-encoded path segments", () => {
    expect(normalizeUrl("/path/%65ncoded")).toBe("/path/encoded");
  });

  it("buildIndexedAncestorCoverSet marks ancestor paths covered by deeper indexed URLs", () => {
    const cover = buildIndexedAncestorCoverSet(new Set(["/insights/articles/post-a"]));
    expect(cover.has("/insights/articles/post-a")).toBe(true);
    expect(cover.has("/insights/articles")).toBe(true);
    expect(cover.has("/insights")).toBe(true);
    expect(cover.has("/insights/blogs")).toBe(false);
  });

  it("normalizeUrlPattern matches compare logic", () => {
    expect(normalizeUrlPattern("insights/blogs")).toBe("/insights/blogs");
    expect(normalizeUrlPattern("/insights/blogs/")).toBe("/insights/blogs");
  });

  it("matchesPattern uses normalized path prefix rules", () => {
    expect(matchesPattern("https://a.com/insights/blogs/post", ["/insights/blogs"])).toBe(true);
    expect(matchesPattern("https://a.com/people/x", ["/insights/blogs"])).toBe(false);
    expect(matchesPattern("https://a.com/insights/blogs", ["/insights/blogs"])).toBe(true);
  });

  it("normalizeUrls maps each URL", () => {
    expect(normalizeUrls(["https://ex.com/a", "https://ex.com/B/"])).toEqual(["/a", "/b"]);
  });
});
