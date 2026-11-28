import { RABBITMQ_QUEUES } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { EmailConsumer } from '../consumers/email.consumer';
import {
  fakeProcessed,
  fakeRabbit,
  withRole,
} from '../../../infrastructure/messaging/rabbitmq/consumer-harness-spec';

describe('EmailConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let emailService: { sendEmail: jest.Mock };
  let consumer: EmailConsumer;
  let idempotency: ReturnType<typeof fakeProcessed>;

  beforeEach(() => {
    harness = fakeRabbit();
    emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    consumer = new EmailConsumer(
      harness.rabbit,
      emailService as never,
      (idempotency = fakeProcessed()).processed,
    );
    jest
      .spyOn((consumer as any).logger, 'log')
      .mockImplementation(() => undefined);
    jest
      .spyOn((consumer as any).logger, 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn((consumer as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  async function handle(payload: unknown, messageId?: string) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.EMAILS)(payload, {
      properties: { messageId },
    });
  }

  it('consumes the emails queue', async () => {
    await consumer.onModuleInit();
    expect(harness.consume).toHaveBeenCalledWith(
      RABBITMQ_QUEUES.EMAILS,
      expect.any(Function),
    );
  });

  it('sends a valid message through the email service', async () => {
    await handle({ to: 'a@b.com', subject: 'Hi', html: '<p>x</p>', text: 'x' });

    expect(emailService.sendEmail).toHaveBeenCalledWith({
      to: 'a@b.com',
      subject: 'Hi',
      html: '<p>x</p>',
      text: 'x',
    });
  });

  it.each([
    ['no payload', undefined],
    ['no recipient', { subject: 'Hi', html: 'x' }],
    ['no subject', { to: 'a@b.com', html: 'x' }],
  ])(
    'rejects a message with %s as permanently bad, without sending',
    async (_label, payload) => {
      await expect(handle(payload)).rejects.toMatchObject({
        name: 'PermanentConsumerError',
      });
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    },
  );

  it('does not send the same message twice when the broker redelivers it', async () => {
    idempotency.runOnce.mockImplementation(
      async (_c: string, id: string | undefined, work: () => Promise<void>) => {
        if (id === 'm-1') return 'duplicate' as const;
        await work();
        return 'ran' as const;
      },
    );

    await handle({ to: 'a@b.com', subject: 'Hi' }, 'm-1');

    expect(idempotency.runOnce).toHaveBeenCalledWith(
      'email',
      'm-1',
      expect.any(Function),
    );
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('rethrows a delivery failure so the broker can retry or dead-letter it', async () => {
    emailService.sendEmail.mockRejectedValue(new Error('provider down'));

    await expect(handle({ to: 'a@b.com', subject: 'Hi' })).rejects.toThrow(
      'provider down',
    );
  });

  it.each(['api', 'jobs'])(
    'does not consume in the %s program',
    async (role) => {
      await withRole(role, () => consumer.onModuleInit());
      expect(harness.consume).not.toHaveBeenCalled();
    },
  );

  it.each(['worker', 'all', undefined])(
    'consumes in the %s program',
    async (role) => {
      await withRole(role, () => consumer.onModuleInit());
      expect(harness.consume).toHaveBeenCalledTimes(1);
    },
  );
});
