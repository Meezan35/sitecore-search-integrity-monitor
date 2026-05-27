import { logger } from "./logger";
import { sleep } from "./sleep";

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 10_000;

export interface RetryOptions {
  retries: number;
  /** Base delay (ms) for exponential backoff: `base * 2^attempt + jitter`. */
  delayMs?: number;
  /** Upper cap (ms) for each wait. Default 10000. */
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, computedDelayMs: number, waitMs: number) => void;
  /** If set, replaces or extends the computed backoff (e.g. Retry-After). */
  resolveDelayMs?: (error: unknown, computedBackoffMs: number) => number;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const retries = Math.max(1, options.retries);
  const baseDelayMs = options.delayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  let attempt = 0;

  while (attempt < retries) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (getErrorCode(error) === "ENOTFOUND") {
        throw error;
      }

      const hasRemainingAttempts = attempt < retries;
      const retryAllowed = options.shouldRetry ? options.shouldRetry(error, attempt) : true;

      if (!hasRemainingAttempts || !retryAllowed) {
        throw error;
      }

      const computedDelayMs = Math.min(
        Math.round(baseDelayMs * 2 ** attempt + Math.random() * 500),
        maxDelay,
      );
      const waitMs =
        options.resolveDelayMs != null
          ? options.resolveDelayMs(error, computedDelayMs)
          : computedDelayMs;

      logger.info({ attempt, computedDelayMs, waitMs }, "Retry backoff before sleep");
      options.onRetry?.(error, attempt, computedDelayMs, waitMs);
      await sleep(waitMs);
    }
  }

  throw new Error("Retry attempts exhausted.");
}
