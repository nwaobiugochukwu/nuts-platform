import { Batcher } from '../utils/audit-batcher.util';

describe('Batcher', () => {
  afterEach(() => jest.useRealTimers());

  it('flushes when the batch is full and resolves every caller', async () => {
    const flush = jest.fn().mockResolvedValue(undefined);
    const batcher = new Batcher<number>({
      maxSize: 3,
      maxWaitMs: 10_000,
      flush,
    });
    await Promise.all([batcher.add(1), batcher.add(2), batcher.add(3)]);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('flushes a partial batch after the wait time', async () => {
    jest.useFakeTimers();
    const flush = jest.fn().mockResolvedValue(undefined);
    const batcher = new Batcher<string>({ maxSize: 50, maxWaitMs: 250, flush });
    const first = batcher.add('a');
    const second = batcher.add('b');
    expect(flush).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(250);
    await Promise.all([first, second]);
    expect(flush).toHaveBeenCalledWith(['a', 'b']);
  });

  it('rejects every caller of a failed batch', async () => {
    const flush = jest.fn().mockRejectedValue(new Error('db down'));
    const batcher = new Batcher<number>({
      maxSize: 2,
      maxWaitMs: 10_000,
      flush,
    });
    const results = await Promise.allSettled([batcher.add(1), batcher.add(2)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });

  it('starts a fresh batch after a flush', async () => {
    const flush = jest.fn().mockResolvedValue(undefined);
    const batcher = new Batcher<number>({
      maxSize: 1,
      maxWaitMs: 10_000,
      flush,
    });
    await batcher.add(1);
    await batcher.add(2);
    expect(flush).toHaveBeenNthCalledWith(1, [1]);
    expect(flush).toHaveBeenNthCalledWith(2, [2]);
  });
});
