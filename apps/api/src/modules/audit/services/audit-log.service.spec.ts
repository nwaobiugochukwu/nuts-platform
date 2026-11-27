import { AUDIT_FALLBACK_LIMIT, AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  const flushPromises = () => new Promise((resolve) => setImmediate(resolve));
  let writer: { writeBatch: jest.Mock };
  let rabbit: { isAvailable: jest.Mock; publish: jest.Mock };
  let service: AuditLogService;

  beforeEach(() => {
    writer = { writeBatch: jest.fn().mockResolvedValue(undefined) };
    rabbit = {
      isAvailable: jest.fn().mockReturnValue(true),
      publish: jest.fn().mockResolvedValue(true),
    };
    service = new AuditLogService(writer as never, rabbit as never);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('publishes to the queue and does not touch the database', async () => {
    await service.log({ action: 'A', entity: 'E', entityId: '1', userId: 'u' });
    await flushPromises();
    expect(rabbit.publish).toHaveBeenCalledWith(
      'audit.event',
      expect.objectContaining({ action: 'A', entity: 'E', userId: 'u' }),
    );
    expect(writer.writeBatch).not.toHaveBeenCalled();
  });

  it('returns before the publish completes (callers never wait)', async () => {
    let release: (value: boolean) => void = () => undefined;
    rabbit.publish.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    await expect(
      service.log({ action: 'A', entity: 'E' }),
    ).resolves.toBeUndefined();
    release(true);
  });

  it('falls back to a batched database write when the broker is down', async () => {
    jest.useFakeTimers();
    rabbit.isAvailable.mockReturnValue(false);
    await service.log({ action: 'A', entity: 'E' });
    await service.log({ action: 'B', entity: 'E' });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(writer.writeBatch).toHaveBeenCalledTimes(1);
    const events = writer.writeBatch.mock.calls[0][0] as Array<{
      action: string;
    }>;
    expect(events.map((e) => e.action)).toEqual(['A', 'B']);
  });

  it('falls back when the publish is rejected or throws', async () => {
    jest.useFakeTimers();
    rabbit.publish.mockResolvedValueOnce(false);
    rabbit.publish.mockRejectedValueOnce(new Error('boom'));
    await service.log({ action: 'A', entity: 'E' });
    await service.log({ action: 'B', entity: 'E' });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(writer.writeBatch.mock.calls[0][0]).toHaveLength(2);
  });

  it('keeps events when the fallback write fails and retries them', async () => {
    jest.useFakeTimers();
    rabbit.isAvailable.mockReturnValue(false);
    writer.writeBatch.mockRejectedValueOnce(new Error('db down'));
    await service.log({ action: 'A', entity: 'E' });
    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(writer.writeBatch).toHaveBeenCalledTimes(2);
    expect(writer.writeBatch.mock.calls[1][0]).toHaveLength(1);
  });

  it('bounds the fallback buffer by dropping the oldest events', async () => {
    jest.useFakeTimers();
    rabbit.isAvailable.mockReturnValue(false);
    for (let i = 0; i < AUDIT_FALLBACK_LIMIT + 5; i += 1) {
      service.record({
        eventId: `e${i}`,
        occurredAt: new Date().toISOString(),
        action: 'A',
        entity: 'E',
      });
    }
    await jest.advanceTimersByTimeAsync(1_000);
    const events = writer.writeBatch.mock.calls[0][0] as Array<{
      eventId: string;
    }>;
    expect(events).toHaveLength(AUDIT_FALLBACK_LIMIT);
    expect(events[0].eventId).toBe('e5');
  });

  it('flushes what is buffered on shutdown', async () => {
    rabbit.isAvailable.mockReturnValue(false);
    await service.log({ action: 'A', entity: 'E' });
    await flushPromises();
    await service.onModuleDestroy();
    expect(writer.writeBatch).toHaveBeenCalledTimes(1);
  });
});
