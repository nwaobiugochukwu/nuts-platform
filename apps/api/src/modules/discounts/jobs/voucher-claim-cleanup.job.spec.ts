import { fakeCronRedis } from '@api/infrastructure/cache/cron-lock-harness-spec';
import { VoucherClaimCleanupJob } from './voucher-claim-cleanup.job';

describe('VoucherClaimCleanupJob', () => {
  let claims: { purgeStale: jest.Mock };

  beforeEach(() => {
    claims = { purgeStale: jest.fn() };
  });

  function build(redisOptions = {}) {
    const { redis, set } = fakeCronRedis(redisOptions);
    const cron = new VoucherClaimCleanupJob(claims as never, redis);
    jest.spyOn((cron as any).logger, 'log').mockImplementation(() => undefined);
    jest
      .spyOn((cron as any).logger, 'error')
      .mockImplementation(() => undefined);
    return { cron, set };
  }

  it('purges in rounds until nothing is left, under its own lock', async () => {
    claims.purgeStale
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(0);
    const { cron, set } = build();

    await cron.purge();

    expect(claims.purgeStale).toHaveBeenCalledTimes(3);
    expect(set).toHaveBeenCalledWith(
      'cron:lock:voucher-claim-cleanup',
      expect.any(String),
      'PX',
      900_000,
      'NX',
    );
    expect((cron as any).logger.log).toHaveBeenCalledWith(
      'Removed 620 stale voucher claims.',
    );
  });

  it('stays quiet when there was nothing to remove', async () => {
    claims.purgeStale.mockResolvedValue(0);
    const { cron } = build();

    await cron.purge();

    expect(claims.purgeStale).toHaveBeenCalledTimes(1);
    expect((cron as any).logger.log).not.toHaveBeenCalled();
  });

  it('stops after 100 rounds even if there is always more', async () => {
    claims.purgeStale.mockResolvedValue(10);
    const { cron } = build();

    await cron.purge();

    expect(claims.purgeStale).toHaveBeenCalledTimes(100);
  });

  it('does nothing when another process holds the lock', async () => {
    const { cron } = build({ alreadyLocked: true });

    await cron.purge();

    expect(claims.purgeStale).not.toHaveBeenCalled();
  });

  it('logs a failure and does not throw, so the scheduler keeps running', async () => {
    claims.purgeStale.mockRejectedValue(new Error('db down'));
    const { cron } = build();

    await expect(cron.purge()).resolves.toBeUndefined();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      'Failed to purge stale voucher claims',
      expect.any(String),
    );
  });
});
