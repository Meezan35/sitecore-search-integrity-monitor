import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withRetry } from "../../src/utils/retry";

function enotfoundError(): Error & { code: string } {
  return Object.assign(new Error("getaddrinfo ENOTFOUND example.com"), { code: "ENOTFOUND" });
}

function http503Error(): Error & { response: { status: number } } {
  return Object.assign(new Error("Service unavailable"), { response: { status: 503 } });
}

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not retry ENOTFOUND", async () => {
    const op = vi.fn().mockRejectedValue(enotfoundError());
    const result = withRetry(op, { retries: 5, shouldRetry: () => true });
    await expect(result).rejects.toMatchObject({ code: "ENOTFOUND" });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries on 503 with bounded backoff then succeeds", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(http503Error())
      .mockResolvedValueOnce("ok");

    const resultPromise = withRetry(op, {
      retries: 4,
      delayMs: 1000,
      maxDelayMs: 10_000,
      shouldRetry: () => true,
    });

    await vi.advanceTimersByTimeAsync(15_000);
    await expect(resultPromise).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });
});
