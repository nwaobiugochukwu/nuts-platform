import { ConfigService } from '@nestjs/config';
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
