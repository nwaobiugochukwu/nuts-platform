import { runWithRequestId } from '@api/common/request-context/request-context.util';
import { OutboxService } from './outbox.service';

describe('OutboxService request ids', () => {
  const build = () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { outboxEvent: { create } };
    const relay = { notifyNewEvent: jest.fn() };
    const service = new OutboxService({} as never, relay as never);
    return { service, tx, create, relay };
  };

  it('stores the request that caused the event so the relay can restore it', async () => {
    const { service, tx, create } = build();
    await runWithRequestId('req-outbox-01', () =>
      service.appendEvent(tx as never, 'order', 'o1', 'order.created', {
        id: 'o1',
      }),
    );
    expect(create.mock.calls[0][0].data.payload).toMatchObject({
      id: 'o1',
      requestId: 'req-outbox-01',
    });
  });

  it('adds nothing outside a request and does not override an explicit id', async () => {
    const { service, tx, create } = build();
    await service.appendEvent(tx as never, 'order', 'o1', 'x', { id: 'o1' });
    expect(create.mock.calls[0][0].data.payload).not.toHaveProperty(
      'requestId',
    );
    await runWithRequestId('req-outbox-02', () =>
      service.appendEvent(tx as never, 'order', 'o1', 'x', {
        requestId: 'kept-id-0001',
      }),
    );
    expect(create.mock.calls[1][0].data.payload.requestId).toBe('kept-id-0001');
  });

  it('wakes the relay only when asked to', async () => {
    const { service, tx, relay } = build();
    await service.appendEvent(tx as never, 'a', '1', 'x', {});
    expect(relay.notifyNewEvent).toHaveBeenCalledTimes(1);
    await service.appendEvent(
      tx as never,
      'a',
      '1',
      'x',
      {},
      { wakeRelay: false },
    );
    expect(relay.notifyNewEvent).toHaveBeenCalledTimes(1);
    service.wakeRelay();
    expect(relay.notifyNewEvent).toHaveBeenCalledTimes(2);
  });
});
