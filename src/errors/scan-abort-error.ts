export class ScanAbortError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ScanAbortError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}
