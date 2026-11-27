import { RABBITMQ_QUEUES } from '@api/infrastructure/rabbitmq/rabbitmq.constants';
import {
  fakeRabbit,
  withRole,
} from '@api/infrastructure/rabbitmq/consumer-harness-spec';
import { AuditConsumer } from './audit.consumer';

describe('AuditConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let writer: { writeBatch: jest.Mock };
  let consumer: AuditConsumer;
  const event = { eventId: 'a1', action: 'ORDER_SHIPPED', entity: 'order' };

  beforeEach(() => {
    jest.useFakeTimers();
    harness = fakeRabbit();
    writer = { writeBatch: jest.fn().mockResolvedValue(undefined) };
    consumer = new AuditConsumer(harness.rabbit, writer as never);
    jest
      .spyOn((consumer as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.useRealTimers());

  async function handler() {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.AUDIT);
  }

  it('writes an event after the batching window, and only then acknowledges it', async () => {
    const handle = await handler();
    let acknowledged = false;
    const pending = handle(event).then(() => {
      acknowledged = true;
    });

    await Promise.resolve();
    expect(writer.writeBatch).not.toHaveBeenCalled();
    expect(acknowledged).toBe(false);

    await jest.advanceTimersByTimeAsync(300);
    await pending;

    expect(writer.writeBatch).toHaveBeenCalledWith([event]);
    expect(acknowledged).toBe(true);
  });

  it('writes events that arrive together as one batch', async () => {
    const handle = await handler();
    const first = handle({ ...event, eventId: 'a1' });
    const second = handle({ ...event, eventId: 'a2' });

    await jest.advanceTimersByTimeAsync(300);
    await Promise.all([first, second]);

    expect(writer.writeBatch).toHaveBeenCalledTimes(1);
    expect(
      writer.writeBatch.mock.calls[0][0].map((e: any) => e.eventId),
    ).toEqual(['a1', 'a2']);
  });

  it('flushes at once when the batch is full (50)', async () => {
    const handle = await handler();
    const all = Array.from({ length: 50 }, (_, i) =>
      handle({ ...event, eventId: `e${i}` }),
    );

    await Promise.all(all);

    expect(writer.writeBatch).toHaveBeenCalledTimes(1);
    expect(writer.writeBatch.mock.calls[0][0]).toHaveLength(50);
  });

  it.each([
    ['no event id', { action: 'X', entity: 'order' }],
    ['no action', { eventId: 'a', entity: 'order' }],
    ['no entity', { eventId: 'a', action: 'X' }],
    ['no payload', undefined],
  ])(
    'skips a malformed message (%s) without failing it',
    async (_label, payload) => {
      const handle = await handler();

      await expect(handle(payload)).resolves.toBeUndefined();
      await jest.advanceTimersByTimeAsync(300);

      expect(writer.writeBatch).not.toHaveBeenCalled();
    },
  );

  it('fails the message when the batch cannot be written, so it is retried', async () => {
    writer.writeBatch.mockRejectedValue(new Error('db down'));
    const handle = await handler();

    const pending = handle(event);
    const assertion = expect(pending).rejects.toThrow('db down');
    await jest.advanceTimersByTimeAsync(300);

    await assertion;
  });

  it('does not consume in the api program', async () => {
    await withRole('api', () => consumer.onModuleInit());
    expect(harness.consume).not.toHaveBeenCalled();
  });
});
