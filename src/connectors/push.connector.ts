import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { ScanAbortError } from "../errors/scan-abort-error";
import type { UrlSource } from "../types/connector.types";
import type { SitemapConfig } from "../types/config.types";

export interface PushCachePayload {
  source: string;
  timestamp: string;
  urls: string[];
}

export class PushConnector implements UrlSource {
  constructor(private readonly config: SitemapConfig) {}

  /**
   * Returns unique URLs from the last push (same logical content as a Set).
   */
  async getUrls(): Promise<string[]> {
    const source = this.config.pushSource;
    if (source == null || source.trim().length === 0) {
      throw new ScanAbortError(
        "sitemap.pushSource is required when fetchStrategy is \"push\".",
      );
    }

    const maxAgeMs = (this.config.pushMaxAgeHours ?? 25) * 60 * 60 * 1000;
    const cacheDir = join(process.cwd(), "push-cache");
    const filePath = join(cacheDir, `${source}.json`);

    if (!existsSync(filePath)) {
      throw new ScanAbortError(
        `No recent push received for source "${source}". Push cache file is missing.`,
      );
    }

    let payload: PushCachePayload;
    try {
      const raw = readFileSync(filePath, "utf8");
      payload = JSON.parse(raw) as PushCachePayload;
    } catch (error) {
      throw new ScanAbortError(
        `Push cache file is invalid or unreadable: ${filePath}`,
        error,
      );
    }

    const pushTimeMs = this.resolvePushTimeMs(filePath, payload.timestamp);
    const ageMs = Date.now() - pushTimeMs;
    const ageHours = ageMs / (60 * 60 * 1000);

    if (ageMs > maxAgeMs) {
      throw new ScanAbortError(
        `No recent push received. Last push was ${ageHours.toFixed(1)} hours ago.`,
      );
    }

    if (!Array.isArray(payload.urls)) {
      throw new ScanAbortError(`Push cache for "${source}" has no urls array.`);
    }

    return [...new Set(payload.urls.filter((u) => typeof u === "string" && u.trim().length > 0))];
  }

  private resolvePushTimeMs(filePath: string, timestampField: string | undefined): number {
    if (typeof timestampField === "string" && timestampField.trim().length > 0) {
      const parsed = Date.parse(timestampField);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return statSync(filePath).mtimeMs;
  }
}
