import { OrderEventNotificationsService } from './order-event-notifications.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';

describe('OrderEventNotificationsService referral reward', () => {
  const payload = {
    referralId: 'ref-1',
    referrerId: 'referrer-1',
    referrerEmail: 'ada@example.com',
    referredUserId: 'buyer-1',
    referrerName: 'Ada',
    rewardAmount: 3250,
    currency: 'NGN',
  };
  let rabbitmq: { publish: jest.Mock };
  let outbox: { appendEvent: jest.Mock };
  let preferences: { canSend: jest.Mock };
  let service: OrderEventNotificationsService;

  beforeEach(() => {
    rabbitmq = { publish: jest.fn().mockResolvedValue(true) };
    outbox = { appendEvent: jest.fn().mockResolvedValue(undefined) };
    preferences = { canSend: jest.fn().mockResolvedValue(true) };
    const prisma = {
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})),
    };
    service = new OrderEventNotificationsService(
      rabbitmq as never,
      outbox as never,
      { sendEmail: jest.fn() } as never,
      {
        referralRewardCredited: jest
          .fn()
          .mockReturnValue('<html>reward</html>'),
      } as never,
      prisma as never,
      new TransactionRunnerService(prisma as never, outbox as never),
      { create: jest.fn() } as never,
      preferences as never,
    );
  });

  it('files the email under payment alerts, not marketing (marketing is off by default)', async () => {
    await service.handleReferralReward(payload);

    expect(preferences.canSend).toHaveBeenCalledWith(
      'referrer-1',
      'USER',
      'email',
      'paymentAlerts',
    );
    expect(rabbitmq.publish).toHaveBeenCalledWith(
      'email.dispatch',
      expect.objectContaining({
        to: 'ada@example.com',
        subject: 'You Earned a Referral Reward!',
      }),
    );
  });

  it("files the in-app notice under payment alerts too, so it follows the shopper's payment settings", async () => {
    await service.handleReferralReward(payload);

    const dispatched = outbox.appendEvent.mock.calls.find(
      (call) => call[3] === 'notification.dispatch',
    );
    expect(dispatched?.[4]).toMatchObject({
      userId: 'referrer-1',
      title: 'Referral Reward Credited',
      category: 'paymentAlerts',
      dedupeKey: 'SYSTEM_ANNOUNCEMENT:referral:ref-1:USER:referrer-1',
    });
  });

  it('sends nothing by email when the shopper has switched payment alerts off', async () => {
    preferences.canSend.mockResolvedValue(false);

    await service.handleReferralReward(payload);

    expect(rabbitmq.publish).not.toHaveBeenCalled();
  });
});
