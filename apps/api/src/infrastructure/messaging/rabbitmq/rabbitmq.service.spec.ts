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
      consume: jest.fn(),
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
