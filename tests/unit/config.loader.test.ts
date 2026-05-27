import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, loadConfigs } from "../../src/config/config.loader";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "config-loader-test-"));
}

function writeJsonFile(dir: string, filename: string, content: unknown): string {
  const filePath = join(dir, filename);
  writeFileSync(filePath, JSON.stringify(content, null, 2), "utf8");
  return filePath;
}

function validConfig(apiKey: string): Record<string, unknown> {
  return {
    name: "Test Org",
    environment: "qa",
    sitemap: {
      url: "https://example.com/sitemap.xml",
      fetchStrategy: "http",
      stripLocale: false,
      locales: ["en"],
      delayBetweenRequestsMs: 1500,
    },
    search: {
      apiUrl: "https://discover.sitecorecloud.io/discover/v2/1234567890",
      apiKey,
      pageSize: 500,
      sections: [
        {
          name: "Insights",
          widgetId: "widget-id",
          sources: ["123"],
          urlPatterns: ["/insights/blogs"],
          subtypeField: "type",
          urlField: "url",
          entity: "content",
          locale: { country: "us", language: "en" },
        },
      ],
    },
    thresholds: {
      warningPercent: 90,
      criticalPercent: 50,
    },
    output: {
      dir: "./output",
      retainDays: 30,
    },
  };
}

const originalApiKey = process.env.SITECORE_SEARCH_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.SITECORE_SEARCH_API_KEY;
  } else {
    process.env.SITECORE_SEARCH_API_KEY = originalApiKey;
  }
});

describe("config.loader", () => {
  it("loads a valid config correctly", () => {
    const dir = createTempDir();
    try {
      const filePath = writeJsonFile(dir, "valid.json", validConfig("direct-key"));
      const config = loadConfig(filePath);
      expect(config.name).toBe("Test Org");
      expect(config.search.sections[0].name).toBe("Insights");
      expect(config.sitemap.delayBetweenRequestsMs).toBe(1500);
      expect(config.sitemap.fetchStrategy).toBe("http");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts http config with childSitemapUrls only (skips root URL shape validation)", () => {
    const dir = createTempDir();
    try {
      const cfg = validConfig("direct-key");
      (cfg as { sitemap: Record<string, unknown> }).sitemap = {
        url: "https://example.com/",
        fetchStrategy: "http",
        childSitemapUrls: ["https://example.com/sitemap-1.xml", "https://example.com/sitemap-2.xml"],
        stripLocale: false,
        locales: ["en"],
        delayBetweenRequestsMs: 1500,
      };
      const filePath = writeJsonFile(dir, "child-only.json", cfg);
      const config = loadConfig(filePath);
      expect(config.sitemap.childSitemapUrls).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when http strategy has invalid url and no childSitemapUrls", () => {
    const dir = createTempDir();
    try {
      const cfg = validConfig("direct-key");
      (cfg as { sitemap: Record<string, unknown> }).sitemap = {
        url: "not-a-valid-url",
        fetchStrategy: "http",
        stripLocale: false,
        locales: ["en"],
        delayBetweenRequestsMs: 1500,
      };
      const filePath = writeJsonFile(dir, "bad-url.json", cfg);
      expect(() => loadConfig(filePath)).toThrowError(/url/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws clear validation error for missing required field", () => {
    const dir = createTempDir();
    try {
      const invalid = validConfig("direct-key");
      delete (invalid as { output?: unknown }).output;
      const filePath = writeJsonFile(dir, "missing-field.json", invalid);

      expect(() => loadConfig(filePath)).toThrowError(/output/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves ${ENV_VAR} when env var is set", () => {
    process.env.SITECORE_SEARCH_API_KEY = "resolved-secret";
    const dir = createTempDir();
    try {
      const filePath = writeJsonFile(dir, "env-set.json", validConfig("${SITECORE_SEARCH_API_KEY}"));
      const config = loadConfig(filePath);
      expect(config.search.apiKey).toBe("resolved-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when ${ENV_VAR} is not set", () => {
    delete process.env.SITECORE_SEARCH_API_KEY;
    const dir = createTempDir();
    try {
      const filePath = writeJsonFile(
        dir,
        "env-missing.json",
        validConfig("${SITECORE_SEARCH_API_KEY}"),
      );
      expect(() => loadConfig(filePath)).toThrowError(/SITECORE_SEARCH_API_KEY/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadConfigs loads all .json files in a directory", () => {
    const dir = createTempDir();
    try {
      writeJsonFile(dir, "a.json", validConfig("a-key"));
      writeJsonFile(dir, "b.json", validConfig("b-key"));
      writeFileSync(join(dir, "README.txt"), "skip me", "utf8");

      const configs = loadConfigs(dir);
      expect(configs).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws clear parse error with filename for invalid JSON", () => {
    const dir = createTempDir();
    try {
      const filePath = join(dir, "invalid.json");
      writeFileSync(filePath, "{ invalid json", "utf8");

      expect(() => loadConfig(filePath)).toThrowError(/invalid\.json/i);
      expect(() => loadConfig(filePath)).toThrowError(/parse/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
