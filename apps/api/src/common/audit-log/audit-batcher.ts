interface Pending<T> {
  item: T;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * Collects items from concurrent callers and flushes them together, either when
 * `maxSize` is reached or `maxWaitMs` after the first item. Each `add` resolves
 * when its batch was written (so a queue message is acknowledged only after its
 * row exists) or rejects if the write failed.
 */
export class Batcher<T> {
  private pending: Array<Pending<T>> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      maxSize: number;
      maxWaitMs: number;
      flush: (items: T[]) => Promise<void>;
    },
  ) {}

  add(item: T): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ item, resolve, reject });
      if (this.pending.length >= this.options.maxSize) {
        void this.flushNow();
        return;
      }
      this.timer ??= setTimeout(() => {
        void this.flushNow();
      }, this.options.maxWaitMs);
    });
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;
    try {
      await this.options.flush(batch.map(({ item }) => item));
      for (const entry of batch) entry.resolve();
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    }
  }
}
