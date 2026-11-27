import { NotificationPriority, NotificationType, ROLE } from '@prisma/client';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import {
  fakeRabbit,
  withRole,
} from '@api/infrastructure/messaging/rabbitmq/consumer-harness-spec';
import { NotificationsConsumer } from './notifications.consumer';

describe('NotificationsConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let notifications: { create: jest.Mock };
  let consumer: NotificationsConsumer;

  beforeEach(() => {
    harness = fakeRabbit();
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
    consumer = new NotificationsConsumer(
      harness.rabbit,
      notifications as never,
    );
    jest
      .spyOn((consumer as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  async function handle(payload: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.NOTIFICATIONS)(payload);
  }

  it('creates the notification with defaults for the optional fields', async () => {
    await handle({ userId: 'u1', type: NotificationType.SYSTEM_ANNOUNCEMENT });

    expect(notifications.create).toHaveBeenCalledWith({
      userId: 'u1',
      role: ROLE.USER,
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'New Notification',
      message: '',
      priority: NotificationPriority.MEDIUM,
      link: undefined,
      metadata: undefined,
      dedupeKey: undefined,
    });
  });

  it('passes every supplied field through', async () => {
    await handle({
      userId: 'u1',
      role: ROLE.VENDOR,
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: '  Hello  ',
      message: 'Body',
      priority: NotificationPriority.HIGH,
      link: '/x',
      metadata: { a: 1 },
      dedupeKey: 'k',
    });

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        role: ROLE.VENDOR,
        title: 'Hello',
        message: 'Body',
        priority: NotificationPriority.HIGH,
        link: '/x',
        metadata: { a: 1 },
        dedupeKey: 'k',
      }),
    );
  });

  it('passes a preference category through, and ignores one it does not know', async () => {
    const base = {
      userId: 'u1',
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Referral Reward Credited',
      message: 'Body',
    };

    await handle({ ...base, category: 'paymentAlerts' });
    await handle({ ...base, category: 'not-a-category' });

    expect(notifications.create.mock.calls[0][0].category).toBe(
      'paymentAlerts',
    );
    expect(notifications.create.mock.calls[1][0].category).toBeUndefined();
  });

  it('derives the de-duplication key from the outbox event id, so a redelivery is not shown twice', async () => {
    await handle({
      userId: 'u1',
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      eventId: ' e-9 ',
    });

    expect(notifications.create.mock.calls[0][0].dedupeKey).toBe('outbox:e-9');
  });

  it('an explicit de-duplication key wins over the event id', async () => {
    await handle({
      userId: 'u1',
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      eventId: 'e-9',
      dedupeKey: 'mine',
    });

    expect(notifications.create.mock.calls[0][0].dedupeKey).toBe('mine');
  });

  it('understands the older Order Confirmed message shape', async () => {
    await handle({
      userId: 'u1',
      orderId: 'o1',
      title: 'Order Confirmed',
      message: 'Thanks',
    });

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: NotificationType.ORDER_CONFIRMED,
        priority: NotificationPriority.HIGH,
        link: '/order/o1',
        metadata: { orderId: 'o1' },
        dedupeKey: 'ORDER_CONFIRMED:o1:USER:u1',
      }),
    );
  });

  it.each([
    ['not an object', 'text'],
    ['an array', []],
    ['no user', { type: NotificationType.SYSTEM_ANNOUNCEMENT }],
    [
      'a blank user',
      { userId: '  ', type: NotificationType.SYSTEM_ANNOUNCEMENT },
    ],
    ['an unknown type', { userId: 'u1', type: 'NOT_A_TYPE' }],
    ['no type', { userId: 'u1' }],
  ])(
    'rejects a malformed message (%s) so it reaches the dead-letter queue',
    async (_label, payload) => {
      await expect(handle(payload)).rejects.toThrow(
        'Malformed or incomplete notification message',
      );
      expect(notifications.create).not.toHaveBeenCalled();
    },
  );

  it('rethrows when the notification cannot be stored', async () => {
    notifications.create.mockRejectedValue(new Error('db down'));

    await expect(
      handle({ userId: 'u1', type: NotificationType.SYSTEM_ANNOUNCEMENT }),
    ).rejects.toThrow('db down');
  });

  it('does not consume in the api program', async () => {
    await withRole('api', () => consumer.onModuleInit());
    expect(harness.consume).not.toHaveBeenCalled();
  });
});
