import { buildEnvelope } from '../../../../infrastructure/messaging/events/event-envelope.util';
import {
  fakeProcessed,
  fakeRabbit,
  withRole,
} from '../../../../infrastructure/messaging/rabbitmq/consumer-harness-spec';
import { RABBITMQ_QUEUES } from '../../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { UserEmailsConsumer } from '../../consumers/user-emails.consumer';

describe('UserEmailsConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let idempotency: ReturnType<typeof fakeProcessed>;
  let emails: Record<string, jest.Mock>;
  let notifications: { create: jest.Mock };
  let consumer: UserEmailsConsumer;

  const event = (type: string, payload: object) =>
    buildEnvelope(
      { type, aggregate: { type: 'user', id: 'u-1' }, payload },
      { eventId: 'e-1' },
    );
  const account = { userId: 'u-1', email: 'ada@example.com', firstName: 'Ada' };

  beforeEach(() => {
    harness = fakeRabbit();
    idempotency = fakeProcessed();
    emails = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetSuccessEmail: jest.fn().mockResolvedValue(undefined),
      sendNewDeviceLoginEmail: jest.fn().mockResolvedValue(undefined),
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    consumer = new UserEmailsConsumer(
      harness.rabbit,
      emails as never,
      notifications as never,
      idempotency.processed,
    );
  });

  async function handle(raw: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.USER_EMAILS)(raw);
  }

  it('sends the welcome email for user.registered', async () => {
    await handle(event('user.registered', account));

    expect(emails.sendWelcomeEmail).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada',
    );
    expect(emails.sendPasswordResetSuccessEmail).not.toHaveBeenCalled();
  });

  it('sends the confirmation email for user.password_changed', async () => {
    await handle(event('user.password_changed', account));

    expect(emails.sendPasswordResetSuccessEmail).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada',
    );
  });

  it('greets by an empty name when the account has no first name', async () => {
    await handle(event('user.registered', { ...account, firstName: null }));

    expect(emails.sendWelcomeEmail).toHaveBeenCalledWith('ada@example.com', '');
  });

  describe('user.login_from_new_device', () => {
    const payload = {
      ...account,
      device: 'Safari on iOS',
      ip: '102.89.1.1',
      signedInAt: '2026-11-28T10:00:00.000Z',
    };

    it('emails the customer the device, time and address, and adds an in-app alert', async () => {
      await handle(event('user.login_from_new_device', payload));

      expect(emails.sendNewDeviceLoginEmail).toHaveBeenCalledWith(
        'ada@example.com',
        'Ada',
        {
          device: 'Safari on iOS',
          ip: '102.89.1.1',
          signedInAt: new Date('2026-11-28T10:00:00.000Z'),
        },
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-1',
          priority: 'HIGH',
          dedupeKey: 'SECURITY:new-device:e-1',
          essential: true,
        }),
      );
    });

    it('retries the whole event if the email fails, without having sent the in-app alert twice', async () => {
      emails.sendNewDeviceLoginEmail.mockRejectedValue(new Error('smtp down'));

      await expect(
        handle(event('user.login_from_new_device', payload)),
      ).rejects.toThrow('smtp down');
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  it('handles each event once, by its event id', async () => {
    await handle(event('user.registered', account));

    expect(idempotency.runOnce).toHaveBeenCalledWith(
      'user-emails',
      'e-1',
      expect.any(Function),
    );
  });

  it('does not email again for a redelivered event', async () => {
    const duplicate = fakeProcessed(['e-1']);
    consumer = new UserEmailsConsumer(
      harness.rabbit,
      emails as never,
      notifications as never,
      duplicate.processed,
    );
    harness.consumers.length = 0;

    await handle(event('user.registered', account));

    expect(emails.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an event without an email address',
      event('user.registered', { userId: 'u-1' }),
    ],
    ['another event type', event('user.deleted', account)],
    ['a message that is not an envelope', account],
  ])('dead-letters %s at once', async (_label, raw) => {
    await expect(handle(raw)).rejects.toMatchObject({
      name: 'PermanentConsumerError',
    });
    expect(emails.sendWelcomeEmail).not.toHaveBeenCalled();
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
