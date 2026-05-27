export interface ConcurrencyOptions {
  limit: number;
}

export async function pLimit<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  if (concurrency < 1) {
    throw new Error("concurrency must be at least 1");
  }

  if (tasks.length === 0) {
    return [];
  }

  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const current = nextIndex;
      nextIndex += 1;
      try {
        const value = await tasks[current]();
        results[current] = { status: "fulfilled", value };
      } catch (reason) {
        results[current] = { status: "rejected", reason };
      }
    }
  };

  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));

  return results
    .filter((result): result is PromiseFulfilledResult<T> => result.status === "fulfilled")
    .map((result) => result.value);
}

export async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  mapper: (item: TInput) => Promise<TOutput>,
  options: ConcurrencyOptions,
): Promise<TOutput[]> {
  const tasks = items.map((item) => () => mapper(item));
  return pLimit(tasks, options.limit);
}
