import {
  Controller,
  Get,
  Inject,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';
import { Public } from '@api/common/decorators/public.decorator';
import Redis from 'ioredis';

@ApiTags('HEALTH')
@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Health check (liveness)',
    description:
      'Simple liveness probe that returns OK if the service is running.',
  })
  liveness(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness check (database & cache)',
    description:
      'Readiness probe that verifies database and Redis connections are healthy.',
  })
  @ApiResponse({
    status: 503,
    description: 'Readiness check failed',
  })
  async readiness(): Promise<{
    status: string;
    database: string;
    redis: string;
    redisLatencyMs?: number;
    timestamp: string;
  }> {
    let dbStatus = 'connected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err: unknown) {
      dbStatus = 'disconnected';
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Database readiness check failed: ${msg}`);
    }

    let redisStatus = 'connected';
    let redisLatencyMs: number | undefined;

    if (this.redis) {
      try {
        const start = Date.now();
        const pong = await this.redis.ping();
        redisLatencyMs = Date.now() - start;
        if (pong !== 'PONG') {
          redisStatus = 'degraded';
        }
      } catch (err: unknown) {
        redisStatus = 'disconnected';
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Redis readiness check failed: ${msg}`);
      }
    } else {
      redisStatus = 'disabled';
    }

    if (
      dbStatus !== 'connected' ||
      (redisStatus !== 'connected' && redisStatus !== 'disabled')
    ) {
      throw new ServiceUnavailableException({
        status: 'error',
        database: dbStatus,
        redis: redisStatus,
        redisLatencyMs,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'ok',
      database: dbStatus,
      redis: redisStatus,
      redisLatencyMs,
      timestamp: new Date().toISOString(),
    };
  }
}
