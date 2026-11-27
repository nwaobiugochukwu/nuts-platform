import { RABBITMQ_QUEUES } from './rabbitmq.constants';
import { EmailConsumer } from './email.consumer';
import { fakeRabbit, withRole } from './consumer-harness-spec';

describe('EmailConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let emailService: { sendEmail: jest.Mock };
  let consumer: EmailConsumer;

  beforeEach(() => {
    harness = fakeRabbit();
    emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    consumer = new EmailConsumer(harness.rabbit, emailService as never);
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

  async function handle(payload: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.EMAILS)(payload);
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
    'skips a message with %s without sending or failing',
    async (_label, payload) => {
      await expect(handle(payload)).resolves.toBeUndefined();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    },
  );

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
