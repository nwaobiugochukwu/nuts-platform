import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RedlockService } from './redlock.service';

export * from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis => {
        const logger = new Logger('RedisModule');
        const redisUrl = configService.getOrThrow<string>('REDIS_URL');

        const client = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          enableOfflineQueue: true,
          connectTimeout: 10000,
          commandTimeout: 10000,
          keepAlive: 10000,
          enableReadyCheck: true,
          lazyConnect: false,
          retryStrategy(times) {
            return Math.min(times * 200, 3000);
          },
        });

        client.on('connect', () => {
          logger.log('Redis TCP connection established');
        });

        client.on('ready', () => {
          logger.log('Redis ready to accept commands');
        });

        client.on('error', (err: Error) => {
          logger.error(`Redis connection error: ${err.message}`);
        });

        client.on('reconnecting', (delay: number) => {
          logger.warn(`Redis reconnecting in ${delay}ms...`);
        });

        client.on('close', () => {
          logger.warn('Redis connection closed');
        });

        return client;
      },
    },
    RedlockService,
  ],
  exports: [REDIS_CLIENT, RedlockService],
})
export class RedisModule {}
