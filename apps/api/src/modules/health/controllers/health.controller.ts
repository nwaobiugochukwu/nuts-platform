import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Logger,
  Optional,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';
import { Public } from '@api/common/decorators/public.decorator';
import type { Response } from 'express';
import Redis from 'ioredis';
import {
  HeartbeatService,
  type BackgroundStatus,
} from '@api/infrastructure/health/heartbeat.service';

@ApiTags('HEALTH')
@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
    @Optional() private readonly heartbeat?: HeartbeatService,
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

  @Get('background')
  @ApiOperation({
    summary: 'Are the worker and jobs programs running?',
    description:
      'Fails (503) when the worker or jobs program has stopped sending heartbeats or a queue has no consumer, which would otherwise be a silent failure: queued emails and scheduled jobs would simply stop. Run after every deploy (scripts/verify-deploy.sh). Not used as a container health check, so a missing worker never takes the API out of rotation.',
  })
  @ApiResponse({
    status: 503,
    description: 'A background program is not running',
  })
  async background(
    // Passthrough keeps the normal response wrapper, so the explanation reaches
    // the caller even though the status is 503 (an exception would be masked).
    @Res({ passthrough: true }) res: Response,
  ): Promise<BackgroundStatus & { timestamp: string }> {
    const status: BackgroundStatus = this.heartbeat
      ? await this.heartbeat.status()
      : {
          ok: false,
          heartbeats: {
            worker: { state: 'missing', ageSeconds: null },
            jobs: { state: 'missing', ageSeconds: null },
          },
          queuesWithoutConsumers: [],
          problems: ['heartbeat service unavailable'],
        };
    if (!status.ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { ...status, timestamp: new Date().toISOString() };
  }
}
