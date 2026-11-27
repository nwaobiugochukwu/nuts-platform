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

  it('gives every work queue a binding, and shares a key between queues only for domain events', () => {
    for (const queue of Object.values(RABBITMQ_QUEUES)) {
      if (queue === RABBITMQ_QUEUES.DLQ) continue;
      expect(QUEUE_BINDINGS[queue].length).toBeGreaterThan(0);
    }
    // A domain event may fan out to several consumers, each on its own queue. A command or a
    // queue-name key belongs to exactly one queue.
    const events = new Set<string>(Object.values(DomainEvents));
    const repeated = allKeys.filter(
      (key, index) => allKeys.indexOf(key) !== index && !events.has(key),
    );
    expect(repeated).toEqual([]);
  });

  it('delivers each domain event to exactly the consumers that react to it (fan-out is explicit)', () => {
    const events = new Set<string>(Object.values(DomainEvents));
    const consumers = new Map<string, string[]>();
    for (const [queue, keys] of Object.entries(QUEUE_BINDINGS)) {
      for (const key of keys) {
        if (events.has(key)) {
          consumers.set(key, [...(consumers.get(key) ?? []), queue].sort());
        }
      }
    }

    const Q = RABBITMQ_QUEUES;
    expect(Object.fromEntries(consumers)).toEqual({
      [DomainEvents.VENDOR_FOLLOWED]: [Q.VENDOR_EVENTS],
      [DomainEvents.VENDOR_UNFOLLOWED]: [Q.VENDOR_EVENTS],
      [DomainEvents.PAYMENT_WEBHOOK_RECEIVED]: [Q.PAYMENT_WEBHOOKS],
      [DomainEvents.USER_REGISTERED]: [Q.USER_EMAILS],
      [DomainEvents.USER_PASSWORD_CHANGED]: [Q.USER_EMAILS],
      [DomainEvents.USER_LOGIN_FROM_NEW_DEVICE]: [Q.USER_EMAILS],
      [DomainEvents.ORDER_PROCESSING]: [Q.ORDER_EVENTS],
      [DomainEvents.ORDER_SHIPPED]: [Q.ORDER_EVENTS],
      [DomainEvents.ORDER_DELIVERED]: [
        Q.ORDER_EVENTS,
        Q.REFERRAL_REWARDS,
      ].sort(),
      [DomainEvents.ORDER_CANCELLED]: [Q.ORDER_EVENTS],
      [DomainEvents.PAYMENT_CONFIRMED]: [
        Q.ORDER_CONFIRMATION_EMAILS,
        Q.ORDER_EVENTS,
      ].sort(),
      [DomainEvents.PAYMENT_FAILED]: [Q.ORDER_EVENTS],
      [DomainEvents.REVIEW_CREATED]: [Q.REVIEW_AGGREGATES],
      [DomainEvents.REVIEW_UPDATED]: [Q.REVIEW_AGGREGATES],
      [DomainEvents.REVIEW_DELETED]: [Q.REVIEW_AGGREGATES],
      [DomainEvents.REFERRAL_REWARD_CREDITED]: [Q.ORDER_EVENTS],
    });
  });
});
