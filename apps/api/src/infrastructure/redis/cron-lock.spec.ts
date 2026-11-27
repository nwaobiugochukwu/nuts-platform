import { fakeCronRedis } from './cron-lock-harness-spec';
import { runWithCronLock } from './cron-lock';

describe('runWithCronLock', () => {
  it('takes the lock with an expiry, runs the job, and releases the lock', async () => {
    const { redis, set, evalScript } = fakeCronRedis();
    const job = jest.fn().mockResolvedValue(undefined);

    const ran = await runWithCronLock(redis, 'cron:lock:x', 60_000, job);

    expect(ran).toBe(true);
    expect(set).toHaveBeenCalledWith(
      'cron:lock:x',
      expect.any(String),
      'PX',
      60_000,
      'NX',
    );
    expect(job).toHaveBeenCalledTimes(1);
    expect(evalScript).toHaveBeenCalledTimes(1);
    // The release only deletes the key when it still holds this run's token.
    const token = (set.mock.calls[0] as unknown[])[1];
    expect(evalScript.mock.calls[0]).toEqual([
      expect.any(String),
      1,
      'cron:lock:x',
      token,
    ]);
  });

  it('skips the job when another process holds the lock', async () => {
    const { redis, evalScript } = fakeCronRedis({ alreadyLocked: true });
    const job = jest.fn();

    const ran = await runWithCronLock(redis, 'cron:lock:x', 60_000, job);

    expect(ran).toBe(false);
    expect(job).not.toHaveBeenCalled();
    expect(evalScript).not.toHaveBeenCalled();
  });

  it('skips the job (never runs it twice) when Redis cannot be reached', async () => {
    const { redis } = fakeCronRedis({ setFails: true });
    const job = jest.fn();

    await expect(
      runWithCronLock(redis, 'cron:lock:x', 60_000, job),
    ).resolves.toBe(false);
    expect(job).not.toHaveBeenCalled();
  });

  it('releases the lock and surfaces the error when the job fails', async () => {
    const { redis, evalScript } = fakeCronRedis();

    await expect(
      runWithCronLock(redis, 'cron:lock:x', 60_000, () =>
        Promise.reject(new Error('job failed')),
      ),
    ).rejects.toThrow('job failed');
    expect(evalScript).toHaveBeenCalledTimes(1);
  });

  it('ignores a failure to release (the expiry frees the lock)', async () => {
    const { redis, evalScript } = fakeCronRedis();
    evalScript.mockRejectedValue(new Error('redis down'));

    await expect(
      runWithCronLock(redis, 'cron:lock:x', 60_000, () => Promise.resolve()),
    ).resolves.toBe(true);
  });

  it('uses a different token for every run', async () => {
    const { redis, set } = fakeCronRedis();

    await runWithCronLock(redis, 'k', 1_000, () => Promise.resolve());
    await runWithCronLock(redis, 'k', 1_000, () => Promise.resolve());

    expect((set.mock.calls[0] as unknown[])[1]).not.toBe(
      (set.mock.calls[1] as unknown[])[1],
    );
  });
});
