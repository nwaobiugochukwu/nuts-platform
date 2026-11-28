import { buildEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import {
  fakeProcessed,
  fakeRabbit,
  withRole,
} from '@api/infrastructure/messaging/rabbitmq/consumer-harness-spec';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { ReferralRewardConsumer } from '../consumers/referral-reward.consumer';

describe('ReferralRewardConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let idempotency: ReturnType<typeof fakeProcessed>;
  let referrals: { grantReferralRewards: jest.Mock };
  let consumer: ReferralRewardConsumer;

  const delivered = (
    payload: object = { orderId: 'o-1', userId: 'u-1' },
    type = 'order.delivered',
  ) =>
    buildEnvelope(
      { type, aggregate: { type: 'order', id: 'o-1' }, payload },
      { eventId: 'e-1' },
    );

  beforeEach(() => {
    harness = fakeRabbit();
    idempotency = fakeProcessed();
    referrals = {
      grantReferralRewards: jest.fn().mockResolvedValue(undefined),
    };
    consumer = new ReferralRewardConsumer(
      harness.rabbit,
      referrals as never,
      idempotency.processed,
    );
  });

  async function handle(raw: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.REFERRAL_REWARDS)(raw);
  }

  it('grants the referral rewards for the delivered order and its customer', async () => {
    await handle(delivered());

    expect(referrals.grantReferralRewards).toHaveBeenCalledWith('o-1', 'u-1');
    expect(idempotency.runOnce).toHaveBeenCalledWith(
      'referral-rewards',
      'e-1',
      expect.any(Function),
    );
  });

  it('does not grant again for a redelivered event', async () => {
    const duplicate = fakeProcessed(['e-1']);
    consumer = new ReferralRewardConsumer(
      harness.rabbit,
      referrals as never,
      duplicate.processed,
    );
    harness.consumers.length = 0;

    await handle(delivered());

    expect(referrals.grantReferralRewards).not.toHaveBeenCalled();
  });

  it('lets a failure through so the queue retries it (a conflict is safe to retry: the grant is idempotent)', async () => {
    referrals.grantReferralRewards.mockRejectedValue(new Error('conflict'));

    await expect(handle(delivered())).rejects.toThrow('conflict');
  });

  it.each([
    ['an event with no order id', delivered({ userId: 'u-1' })],
    ['an event with no user id', delivered({ orderId: 'o-1' })],
    ['another event type', delivered(undefined, 'order.shipped')],
    ['a message that is not an envelope', { orderId: 'o-1', userId: 'u-1' }],
  ])('dead-letters %s at once', async (_label, raw) => {
    await expect(handle(raw)).rejects.toMatchObject({
      name: 'PermanentConsumerError',
    });
    expect(referrals.grantReferralRewards).not.toHaveBeenCalled();
  });

  it.each(['api', 'jobs'])(
    'does not consume in the %s program',
    async (role) => {
      await withRole(role, () => consumer.onModuleInit());
      expect(harness.consume).not.toHaveBeenCalled();
    },
  );

  it('consumes in the worker program', async () => {
    await withRole('worker', () => consumer.onModuleInit());
    expect(harness.consume).toHaveBeenCalledTimes(1);
  });
});
