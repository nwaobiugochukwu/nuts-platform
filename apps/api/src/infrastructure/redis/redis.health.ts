import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthService {
  private readonly logger = new Logger(RedisHealthService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'Redis health check failed',
      );
      return false;
    }
  }

  async getMemoryUsage(): Promise<{ used: string; peak: string } | null> {
    try {
      const info = await this.redis.info('memory');
      const usedMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const peakMatch = info.match(/used_memory_peak_human:([^\r\n]+)/);
      return {
        used: usedMatch?.[1]?.trim() ?? 'unknown',
        peak: peakMatch?.[1]?.trim() ?? 'unknown',
      };
    } catch {
      return null;
    }
  }
}
