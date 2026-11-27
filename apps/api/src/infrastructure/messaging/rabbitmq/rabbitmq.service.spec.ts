import { ConfigService } from '@nestjs/config';
import {
  currentRequestId,
  runWithRequestId,
} from '@api/common/request-context/request-context.util';
import { RabbitMQService } from './rabbitmq.service';

describe('RabbitMQService', () => {
  let service: RabbitMQService;
  let mockConfigService: any;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn(),
    };
  });

  describe('When disabled (RABBITMQ_ENABLED=false)', () => {
    it('gracefully degrades and reports service is unavailable', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultVal: string) => {
          if (key === 'RABBITMQ_ENABLED') return 'false';
          return defaultVal;
        },
      );

      service = new RabbitMQService(mockConfigService as ConfigService);
      await service.onModuleInit();

      expect(service.isAvailable()).toBe(false);

      const published = await service.publish('test.event', { msg: 'hello' });
      expect(published).toBe(false);
    });
  });

  describe('Lifecycle and cleanup', () => {
    it('cleans up reconnect timers upon destroy', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'RABBITMQ_ENABLED') return 'false';
        return undefined;
      });

      service = new RabbitMQService(mockConfigService as ConfigService);
      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(service.isAvailable()).toBe(false);
    });
  });
});

describe('RabbitMQService request ids', () => {
  function connectedService() {
    const published: Array<{ options: { headers?: Record<string, unknown> } }> =
      [];
    const channel = {
      publish: jest.fn(
        (
          _exchange: string,
          _key: string,
          _buffer: Buffer,
          options: { headers?: Record<string, unknown> },
          cb: (err?: Error) => void,
        ) => {
          published.push({ options });
          cb();
          return true;
        },
      ),
      ack: jest.fn(),
      nack: jest.fn(),
      prefetch: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue({ consumerTag: 'tag-1' }),
      cancel: jest.fn().mockResolvedValue(undefined),
      sendToQueue: jest.fn(
        (
          _queue: string,
          _content: Buffer,
          _options: unknown,
          cb: (err?: Error) => void,
        ) => {
          cb();
          return true;
        },
      ),
    };
    const service = new RabbitMQService({ get: jest.fn() } as never);
    Object.assign(service as unknown as Record<string, unknown>, {
      channel,
      isConnected: true,
    });
    return { service, channel, published };
  }

  it('puts the current request id on published messages', async () => {
    const { service, published } = connectedService();
    await runWithRequestId('req-publish-1', () =>
      service.publish('order.created', { id: 1 }),
    );
    expect(published[0].options.headers).toEqual({
      'x-request-id': 'req-publish-1',
    });
  });

  it('adds no header outside a request and never overrides an explicit one', async () => {
    const { service, published } = connectedService();
    await service.publish('a', {});
    expect(published[0].options.headers).toBeUndefined();
    await runWithRequestId('req-ambient-1', () =>
      service.publish(
        'b',
        {},
        { headers: { 'x-request-id': 'explicit-id-1' } },
      ),
    );
    expect(published[1].options.headers).toEqual({
      'x-request-id': 'explicit-id-1',
    });
  });

  it('restores the request id for the handler of a consumed message', async () => {
    const { service, channel } = connectedService();
    const seen: Array<string | undefined> = [];
    await (
      service as unknown as {
        bindConsumer: (q: string, h: () => Promise<void>) => Promise<void>;
      }
    ).bindConsumer('q.test', () => {
      seen.push(currentRequestId());
      return Promise.resolve();
    });
    const onMessage = channel.consume.mock.calls[0][1] as (m: unknown) => void;
    const message = (headers: Record<string, unknown>) => ({
      content: Buffer.from('{}'),
      properties: { headers },
    });
    onMessage(message({ 'x-request-id': 'from-queue-1' }));
    onMessage(message({ 'x-request-id': 'bad id with spaces' }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toEqual(['from-queue-1', undefined]);
    expect(channel.ack).toHaveBeenCalledTimes(2);
  });
});

describe('RabbitMQService failure handling', () => {
  type Internals = {
    bindConsumer: (
      q: string,
      h: (p: unknown, m: unknown) => Promise<void>,
    ) => Promise<boolean>;
  };
  const message = (headers: Record<string, unknown> = {}) => ({
    content: Buffer.from('{"a":1}'),
    properties: { headers, messageId: 'm-1', contentType: 'application/json' },
  });

  function setup(handler: (p: unknown, m: unknown) => Promise<void>) {
    const channel = {
      ack: jest.fn(),
      nack: jest.fn(),
      prefetch: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue({ consumerTag: 'tag-1' }),
      cancel: jest.fn().mockResolvedValue(undefined),
      sendToQueue: jest.fn(
        (_q: string, _c: Buffer, _o: unknown, cb: (err?: Error) => void) => {
          cb();
          return true;
        },
      ),
    };
    const service = new RabbitMQService({ get: jest.fn() } as never);
    Object.assign(service as unknown as Record<string, unknown>, {
      channel,
      isConnected: true,
    });
    const internals = service as unknown as Internals;
    const bound = internals.bindConsumer('q.nuts.emails', handler);
    const deliver = async (msg: unknown) => {
      await bound;
      (channel.consume.mock.calls[0][1] as (m: unknown) => void)(msg);
      await new Promise((resolve) => setImmediate(resolve));
    };
    return { service, channel, internals, deliver };
  }

  it('retries a transient failure through the 10 s retry queue and acknowledges the original', async () => {
    const { channel, deliver } = setup(() =>
      Promise.reject(new Error('db down')),
    );

    await deliver(message());

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'q.nuts.emails.retry.10s',
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        messageId: 'm-1',
        headers: expect.objectContaining({ 'x-nuts-attempt': 1 }),
      }),
      expect.any(Function),
    );
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('uses the next, longer retry queue on each further failure', async () => {
    const { channel, deliver } = setup(() =>
      Promise.reject(new Error('db down')),
    );

    await deliver(message({ 'x-nuts-attempt': 2 }));

    expect(channel.sendToQueue.mock.calls[0][0]).toBe(
      'q.nuts.emails.retry.10m',
    );
  });

  it('dead-letters a message after its last retry', async () => {
    const { channel, deliver } = setup(() =>
      Promise.reject(new Error('db down')),
    );

    await deliver(message({ 'x-nuts-attempt': 3 }));

    expect(channel.sendToQueue).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('dead-letters an unreadable message at once, without retrying', async () => {
    const { channel, deliver } = setup(() => Promise.resolve());

    await deliver({
      content: Buffer.from('not json'),
      properties: { headers: {} },
    });

    expect(channel.sendToQueue).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('waits on an open circuit breaker without using a retry', async () => {
    const open = Object.assign(new Error('open'), {
      name: 'BrokenCircuitError',
    });
    const { channel, deliver } = setup(() => Promise.reject(open));

    await deliver(message({ 'x-nuts-attempt': 3 }));

    expect(channel.sendToQueue.mock.calls[0][0]).toBe('q.nuts.emails.retry.1m');
    expect((channel.sendToQueue.mock.calls[0] as unknown[][])[2]).toMatchObject(
      { headers: expect.anything() },
    );
    expect(
      (
        (channel.sendToQueue.mock.calls[0] as unknown[])[2] as {
          headers: unknown;
        }
      ).headers,
    ).toEqual(
      expect.objectContaining({
        'x-nuts-attempt': 3,
        'x-nuts-circuit-waits': 1,
      }),
    );
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('keeps the message (requeues it) when the retry queue cannot take it', async () => {
    const { channel, deliver } = setup(() =>
      Promise.reject(new Error('db down')),
    );
    channel.sendToQueue.mockImplementation(
      (_q: string, _c: Buffer, _o: unknown, cb: (err?: Error) => void) => {
        cb(new Error('nack'));
        return true;
      },
    );

    await deliver(message());

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
  });

  it('gives each queue its own prefetch', async () => {
    const { channel, internals } = setup(() => Promise.resolve());
    await internals.bindConsumer('q.nuts.inventory', () => Promise.resolve());

    expect(channel.prefetch.mock.calls.map((c) => c[0])).toEqual([5, 1]);
  });

  it('binds a handler only once, even if it is registered and bound twice', async () => {
    const handler = () => Promise.resolve();
    const { channel, internals } = setup(handler);
    const again = await internals.bindConsumer('q.nuts.emails', handler);

    expect(again).toBe(false);
    expect(channel.consume).toHaveBeenCalledTimes(1);
  });

  it('on shutdown stops taking messages and waits for the one being handled', async () => {
    let finish: () => void = () => undefined;
    const { service, channel, deliver } = setup(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    await deliver(message());
    expect(channel.ack).not.toHaveBeenCalled();

    const closing = service.onModuleDestroy();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(channel.cancel).toHaveBeenCalledWith('tag-1');
    finish();
    await closing;

    expect(channel.ack).toHaveBeenCalledTimes(1);
  });
});
