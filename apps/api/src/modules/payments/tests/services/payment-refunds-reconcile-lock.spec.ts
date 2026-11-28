import { fakeCronRedis } from '@api/infrastructure/cache/cron-lock-harness-spec';
import { PaymentRefundsService } from '../../services/payment-refunds.service';

describe('PaymentRefundsService.reconcilePendingRefunds lock', () => {
  const build = (redis: unknown) => {
    const prisma = {
      paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new PaymentRefundsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      redis as never,
    );
    return { service, prisma };
  };

  it('looks for refunds to reconcile when it wins the lock, then releases it', async () => {
    const { redis, set, evalScript } = fakeCronRedis();
    const { service, prisma } = build(redis);

    await service.reconcilePendingRefunds();

    expect(set).toHaveBeenCalledWith(
      'cron:lock:refund-reconcile',
      expect.any(String),
      'PX',
      240_000,
      'NX',
    );
    expect(prisma.paymentRefund.findMany).toHaveBeenCalledTimes(1);
    expect(evalScript).toHaveBeenCalledTimes(1);
  });

  it('does nothing when another instance holds the lock', async () => {
    const { redis } = fakeCronRedis({ alreadyLocked: true });
    const { service, prisma } = build(redis);

    await service.reconcilePendingRefunds();

    expect(prisma.paymentRefund.findMany).not.toHaveBeenCalled();
  });

  it('does nothing, rather than run unprotected, when Redis is unreachable', async () => {
    const { redis } = fakeCronRedis({ setFails: true });
    const { service, prisma } = build(redis);

    await service.reconcilePendingRefunds();

    expect(prisma.paymentRefund.findMany).not.toHaveBeenCalled();
  });
});
