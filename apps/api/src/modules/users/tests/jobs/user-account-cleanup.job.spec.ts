import { fakeCronRedis } from '@api/infrastructure/cache/cron-lock-harness-spec';
import { UserAccountCleanupJob } from '../../jobs/user-account-cleanup.job';

describe('UserAccountCleanupJob', () => {
  let users: { purgeScheduledDeletions: jest.Mock };

  beforeEach(() => {
    users = { purgeScheduledDeletions: jest.fn() };
  });

  function build(redisOptions = {}) {
    const { redis, set } = fakeCronRedis(redisOptions);
    const cron = new UserAccountCleanupJob(users as never, redis);
    jest.spyOn((cron as any).logger, 'log').mockImplementation(() => undefined);
    jest
      .spyOn((cron as any).logger, 'error')
      .mockImplementation(() => undefined);
    return { cron, set };
  }

  it('permanently deletes the accounts whose grace period ended, under a one-hour lock', async () => {
    users.purgeScheduledDeletions.mockResolvedValue(3);
    const { cron, set } = build();

    await cron.purgeExpiredDeactivatedAccounts();

    expect(users.purgeScheduledDeletions).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      'cron:lock:user-account-cleanup',
      expect.any(String),
      'PX',
      3_600_000,
      'NX',
    );
    expect((cron as any).logger.log).toHaveBeenCalledWith(
      'Permanently deleted 3 deactivated account(s)',
    );
  });

  it('stays quiet when no account was due', async () => {
    users.purgeScheduledDeletions.mockResolvedValue(0);
    const { cron } = build();

    await cron.purgeExpiredDeactivatedAccounts();

    expect((cron as any).logger.log).not.toHaveBeenCalled();
  });

  it('does nothing when another process holds the lock', async () => {
    const { cron } = build({ alreadyLocked: true });

    await cron.purgeExpiredDeactivatedAccounts();

    expect(users.purgeScheduledDeletions).not.toHaveBeenCalled();
  });

  it('logs a failure and does not throw', async () => {
    users.purgeScheduledDeletions.mockRejectedValue(new Error('db down'));
    const { cron } = build();

    await expect(
      cron.purgeExpiredDeactivatedAccounts(),
    ).resolves.toBeUndefined();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      'Failed to purge expired deactivated accounts',
      expect.any(String),
    );
  });
});
