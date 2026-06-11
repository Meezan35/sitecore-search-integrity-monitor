import { describe, expect, it } from "vitest";

import { classifyMissingUrls } from "../../src/core/classify-missing";

describe("classifyMissingUrls", () => {
  it("classifies typo slug as mismatch", () => {
    const result = classifyMissingUrls(["/people/luis-abreu"], ["/people/luiss-abreuu"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: "/people/luis-abreu",
      type: "mismatch",
      relatedUrl: "/people/luiss-abreuu",
    });
  });

  it("classifies bucket URL when last path segments match", () => {
    const result = classifyMissingUrls(
      ["/people/caceres-christie"],
      ["/people/c/a/caceres-christie"],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: "/people/caceres-christie",
      type: "bucket-url",
      relatedUrl: "/people/c/a/caceres-christie",
    });
  });

  it("classifies as not-indexed when no similar unexpected URL exists", () => {
    const result = classifyMissingUrls(
      ["/people/daniel-flores"],
      ["/people/john-smith"],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: "/people/daniel-flores",
      type: "not-indexed",
    });
    expect(result[0].relatedUrl).toBeUndefined();
  });

  it("classifies test slug as suspect-test", () => {
    const result = classifyMissingUrls(["/people/detail-bio-test"], []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: "/people/detail-bio-test",
      type: "suspect-test",
    });
  });

  it("classifies number-appended slug as suspect-test", () => {
    const result = classifyMissingUrls(["/people/sunny1-akarapu1"], []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: "/people/sunny1-akarapu1",
      type: "suspect-test",
    });
  });

  it("returns empty array for empty inputs", () => {
    expect(classifyMissingUrls([], [])).toEqual([]);
    expect(classifyMissingUrls([], ["/people/a"])).toEqual([]);
  });

  it("classifies each missing URL independently", () => {
    const result = classifyMissingUrls(
      ["/people/luis-abreu", "/people/daniel-flores", "/people/detail-bio-test"],
      ["/people/luiss-abreuu"],
    );
    expect(result.map((r) => r.type)).toEqual(["mismatch", "not-indexed", "suspect-test"]);
  });

  it("prefers bucket-url over mismatch when both could match", () => {
    const result = classifyMissingUrls(
      ["/people/caceres-christie"],
      ["/people/c/a/caceres-christie", "/people/caceres-christi"],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "bucket-url",
      relatedUrl: "/people/c/a/caceres-christie",
    });
  });
});
