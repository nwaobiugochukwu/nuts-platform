import { NotificationPriority, NotificationType, ROLE } from '@prisma/client';
import {
  RABBITMQ_QUEUES,
  RABBITMQ_ROUTING_KEYS,
} from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import {
  fakeRabbit,
  withRole,
} from '@api/infrastructure/messaging/rabbitmq/consumer-harness-spec';
import { VendorFollowConsumer } from '../../consumers/vendor-follow.consumer';

const message = (routingKey: string) => ({ fields: { routingKey } });

describe('VendorFollowConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let notifications: { create: jest.Mock };
  let consumer: VendorFollowConsumer;
  const event = { eventId: 'e1', userId: 'customer-1', vendorId: 'vendor-1' };

  beforeEach(() => {
    harness = fakeRabbit();
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
    consumer = new VendorFollowConsumer(harness.rabbit, notifications as never);
    jest
      .spyOn((consumer as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  async function handle(payload: unknown, routingKey: string) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.VENDOR_EVENTS)(
      payload,
      message(routingKey),
    );
  }

  it('tells the vendor about a new follower, once per event', async () => {
    await handle(event, RABBITMQ_ROUTING_KEYS.VENDOR_FOLLOWED);

    expect(notifications.create).toHaveBeenCalledWith({
      userId: 'vendor-1',
      role: ROLE.VENDOR,
      type: NotificationType.VENDOR_FOLLOWED,
      title: 'New store follower',
      message: 'Your store has a new follower.',
      priority: NotificationPriority.LOW,
      link: '/vendor/analytic#followers',
      metadata: { eventId: 'e1' },
      dedupeKey: 'vendor-follow:e1',
    });
  });

  it('acknowledges an unfollow without notifying anyone', async () => {
    await expect(
      handle(event, RABBITMQ_ROUTING_KEYS.VENDOR_UNFOLLOWED),
    ).resolves.toBeUndefined();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it.each([
    ['no event id', { userId: 'u', vendorId: 'v' }],
    ['a blank user', { eventId: 'e', userId: ' ', vendorId: 'v' }],
    ['no vendor', { eventId: 'e', userId: 'u' }],
    ['a non-object', 'x'],
  ])('rejects a follow event with %s', async (_label, payload) => {
    await expect(
      handle(payload, RABBITMQ_ROUTING_KEYS.VENDOR_FOLLOWED),
    ).rejects.toThrow('Malformed vendor follow event');
  });

  it('rejects an event that arrives under a routing key it does not handle', async () => {
    await expect(handle(event, 'vendor.something_else')).rejects.toThrow(
      'Malformed vendor follow event',
    );
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('rethrows when the notification cannot be stored', async () => {
    notifications.create.mockRejectedValue(new Error('db down'));

    await expect(
      handle(event, RABBITMQ_ROUTING_KEYS.VENDOR_FOLLOWED),
    ).rejects.toThrow('db down');
  });

  it('does not consume in the jobs program', async () => {
    await withRole('jobs', () => consumer.onModuleInit());
    expect(harness.consume).not.toHaveBeenCalled();
  });
});
