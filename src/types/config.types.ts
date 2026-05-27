import { z } from "zod";

export type SitemapFetchStrategy = "http" | "file" | "push";

export interface SitemapFetchConfig {
  /** Pause before the first sitemap HTTP request. */
  initialDelayMs?: number;
  /** Max attempts per URL including the first try. */
  retries?: number;
  /** Base delay (ms) passed to shared retry (default 1000). */
  baseDelayMs?: number;
  /** Max wait per retry (ms) passed to shared retry (default 10000). */
  maxDelayMs?: number;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  /** Override default User-Agent. */
  userAgent?: string;
  /** Optional same-site Referer for strict WAFs. */
  referer?: string;
}

export interface SitemapConfig {
  /** Canonical sitemap URL (http) or placeholder when using push. */
  url: string;
  fetchStrategy: SitemapFetchStrategy;
  stripLocale: boolean;
  locales: string[];
  delayBetweenRequestsMs: number;
  /** HTTP + file: optional tuning. */
  fetch?: SitemapFetchConfig;
  /** Required when fetchStrategy === "file". */
  localFilePath?: string;
  /** HTTP: when set, skips root fetch; each URL fetched sequentially as child sitemaps. */
  childSitemapUrls?: string[];
  /** Push: identifies cache file push-cache/{pushSource}.json */
  pushSource?: string;
  /** Push: max age of last push before scan aborts (hours). Default 25. */
  pushMaxAgeHours?: number;
}

export interface SectionConfig {
  name: string;
  widgetId: string;
  sources: string[];
  urlPatterns: string[];
  subtypeField: string;
  urlField: string;
  entity: string;
  locale: {
    country: string;
    language: string;
  };
}

export interface ScanTargetConfig {
  name: string;
  environment: "production" | "staging" | "qa";
  sitemap: SitemapConfig;
  search: {
    apiUrl: string;
    apiKey: string;
    pageSize: number;
    sections: SectionConfig[];
  };
  thresholds: {
    warningPercent: number;
    criticalPercent: number;
  };
  output: {
    dir: string;
    retainDays: number;
  };
}

export const sectionConfigSchema = z.object({
  name: z.string().min(1),
  widgetId: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
  urlPatterns: z.array(z.string().min(1)).min(1),
  subtypeField: z.string().min(1),
  urlField: z.string().min(1),
  entity: z.string().min(1),
  locale: z.object({
    country: z.string().min(1),
    language: z.string().min(1),
  }),
});

const sitemapFetchSchema = z
  .object({
    initialDelayMs: z.number().int().nonnegative().max(600_000).optional(),
    retries: z.number().int().positive().max(60).optional(),
    baseDelayMs: z.number().int().positive().max(600_000).optional(),
    maxDelayMs: z.number().int().positive().max(600_000).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    userAgent: z.string().min(1).max(512).optional(),
    referer: z.string().url().optional(),
  })
  .optional();

const sitemapSchema = z
  .object({
    url: z.string().min(1),
    fetchStrategy: z.enum(["http", "file", "push"]).default("http"),
    stripLocale: z.boolean(),
    locales: z.array(z.string().min(1)).default([]),
    delayBetweenRequestsMs: z.number().int().nonnegative().max(600_000).default(1500),
    fetch: sitemapFetchSchema,
    localFilePath: z.string().min(1).optional(),
    childSitemapUrls: z.array(z.string().url()).optional(),
    pushSource: z.string().min(1).optional(),
    pushMaxAgeHours: z.number().positive().max(8760).default(25),
  })
  .superRefine((val, ctx) => {
    const strategy = val.fetchStrategy;

    if (strategy === "file") {
      if (val.localFilePath == null || val.localFilePath.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sitemap.localFilePath is required when fetchStrategy is \"file\"",
          path: ["localFilePath"],
        });
      }
    }

    if (strategy === "push") {
      if (val.pushSource == null || val.pushSource.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sitemap.pushSource is required when fetchStrategy is \"push\"",
          path: ["pushSource"],
        });
      }
    }

    if (strategy === "http") {
      const hasChildren = Array.isArray(val.childSitemapUrls) && val.childSitemapUrls.length > 0;
      if (!hasChildren) {
        const parsed = z.string().url().safeParse(val.url);
        if (!parsed.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "sitemap.url must be a valid URL when fetchStrategy is \"http\" and childSitemapUrls is not set",
            path: ["url"],
          });
        }
      }
    }
  });

export const scanTargetConfigSchema = z.object({
  name: z.string().min(1),
  environment: z.enum(["production", "staging", "qa"]),
  sitemap: sitemapSchema,
  search: z.object({
    apiUrl: z.string().url(),
    apiKey: z.string().min(1),
    pageSize: z.number().int().positive().max(500).default(100),
    sections: z.array(sectionConfigSchema).min(1),
  }),
  thresholds: z.object({
    warningPercent: z.number().min(0).max(100).default(90),
    criticalPercent: z.number().min(0).max(100).default(50),
  }),
  output: z.object({
    dir: z.string().min(1),
    retainDays: z.number().int().nonnegative(),
  }),
});
