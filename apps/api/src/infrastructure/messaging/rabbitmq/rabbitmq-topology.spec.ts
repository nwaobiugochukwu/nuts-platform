import * as amqp from 'amqplib';
import {
  OBSOLETE_BINDINGS,
  QUEUE_BINDINGS,
  RABBITMQ_EXCHANGES,
  RABBITMQ_QUEUES,
  RABBITMQ_ROUTING_KEYS,
} from './rabbitmq.constants';
import { RabbitMQService } from './rabbitmq.service';
import { DomainEvents } from '../events/domain-events.constants';

jest.mock('amqplib');

describe('RabbitMQ topology', () => {
  const channel = {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    unbindQueue: jest.fn().mockResolvedValue(undefined),
    prefetch: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue({ consumerTag: 't' }),
    cancel: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const connection = {
    on: jest.fn(),
    createConfirmChannel: jest.fn().mockResolvedValue(channel),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const connect = async () => {
    (amqp.connect as jest.Mock).mockResolvedValue(connection);
    const service = new RabbitMQService({
      get: (key: string, fallback?: string) =>
        key === 'RABBITMQ_ENABLED' ? 'true' : fallback,
    } as never);
    jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
    await service.onModuleInit();
    return service;
  };

  beforeEach(() => jest.clearAllMocks());

  it('binds every work queue to exactly its declared keys and to the events exchange', async () => {
    const service = await connect();

    const bound = channel.bindQueue.mock.calls.map(
      ([queue, exchange, key]) => `${queue}|${exchange}|${key}`,
    );
    const expected = Object.entries(QUEUE_BINDINGS).flatMap(([queue, keys]) =>
      keys.map((key) => `${queue}|${RABBITMQ_EXCHANGES.TOPIC}|${key}`),
    );
    for (const binding of expected) expect(bound).toContain(binding);
    // the dead-letter queue is the only other binding
    expect(bound).toHaveLength(expected.length + 1);
    await service.onModuleDestroy();
  });

  it('removes the wildcard bindings earlier versions created', async () => {
    const service = await connect();

    for (const { queue, key } of OBSOLETE_BINDINGS) {
      expect(channel.unbindQueue).toHaveBeenCalledWith(
        queue,
        RABBITMQ_EXCHANGES.TOPIC,
        key,
      );
    }
    await service.onModuleDestroy();
  });

  it('declares a retry queue for each delay on every work queue, and none for the dead-letter queue', async () => {
    const service = await connect();

    const declared = channel.assertQueue.mock.calls.map(([name]) => name);
    for (const queue of Object.keys(QUEUE_BINDINGS)) {
      for (const label of ['10s', '1m', '10m']) {
        expect(declared).toContain(`${queue}.retry.${label}`);
      }
    }
    expect(declared.some((n: string) => n.startsWith('q.nuts.dlq.'))).toBe(
      false,
    );
    await service.onModuleDestroy();
  });
});

describe('queue bindings as a design rule', () => {
  const allKeys = Object.values(QUEUE_BINDINGS).flat();

  it('uses no wildcard, so a new domain event can never reach a consumer that cannot read it', () => {
    expect(allKeys.filter((key) => /[*#]/.test(key))).toEqual([]);
  });

  it('gives every work queue a binding, and no queue the same key as another except by design', () => {
    for (const queue of Object.values(RABBITMQ_QUEUES)) {
      if (queue === RABBITMQ_QUEUES.DLQ) continue;
      expect(QUEUE_BINDINGS[queue].length).toBeGreaterThan(0);
    }
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  it('does not collide with a domain event name unless the consumer is meant to receive that event', () => {
    const events = new Set<string>(Object.values(DomainEvents));
    const overlap = allKeys.filter((key) => events.has(key));
    // vendor.followed and vendor.unfollowed are domain events the vendor-events queue consumes.
    expect(overlap.sort()).toEqual([
      RABBITMQ_ROUTING_KEYS.VENDOR_FOLLOWED,
      RABBITMQ_ROUTING_KEYS.VENDOR_UNFOLLOWED,
    ]);
  });
});
