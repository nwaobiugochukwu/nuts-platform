import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { roleCan } from '../configuration/process-role';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RABBITMQ_QUEUES } from '../rabbitmq/rabbitmq.constants';
import { readTemporalConfig } from '../temporal/temporal.config';

/** The background programs whose absence would otherwise go unnoticed. */
export type BackgroundTarget = 'worker' | 'jobs';

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TTL_SECONDS = 120;
/** A heartbeat older than this counts as stale (three missed beats). */
export const HEARTBEAT_STALE_SECONDS = 90;
/** How long the API waits after start before complaining about missing programs. */
export const STARTUP_GRACE_MS = 90_000;

const key = (target: BackgroundTarget) => `nuts:heartbeat:${target}`;

/** Which heartbeats this process is responsible for (an `all` process sends both). */
export function heartbeatTargets(
  env: NodeJS.ProcessEnv = process.env,
): BackgroundTarget[] {
  const targets: BackgroundTarget[] = [];
  if (roleCan('consumers', env)) targets.push('worker');
  if (roleCan('crons', env)) targets.push('jobs');
  return targets;
}

export type TargetState = 'up' | 'stale' | 'missing';

export interface BackgroundStatus {
  ok: boolean;
  heartbeats: Record<
    BackgroundTarget,
    { state: TargetState; ageSeconds: number | null }
  >;
  /** Work queues with no consumer attached; empty when all are served. */
  queuesWithoutConsumers: string[];
  /** Plain-language problems, empty when everything is fine. */
  problems: string[];
}

export function stateFromAge(
  ageSeconds: number | null,
  staleAfter = HEARTBEAT_STALE_SECONDS,
): TargetState {
  if (ageSeconds === null) return 'missing';
  return ageSeconds > staleAfter ? 'stale' : 'up';
}

/** Pure so the rules can be tested without Redis or RabbitMQ. */
export function evaluateBackground(input: {
  ages: Record<BackgroundTarget, number | null>;
  queueStats: Array<{ queue: string; consumers: number }> | null;
  /** Queues whose consumer is switched off on purpose (for example workflows while Temporal is disabled). */
  ignoreQueues?: readonly string[];
}): BackgroundStatus {
  const heartbeats = {
    worker: {
      state: stateFromAge(input.ages.worker),
      ageSeconds: input.ages.worker,
    },
    jobs: {
      state: stateFromAge(input.ages.jobs),
      ageSeconds: input.ages.jobs,
    },
  };
  const queuesWithoutConsumers = (input.queueStats ?? [])
    .filter(
      (stat) =>
        stat.queue !== RABBITMQ_QUEUES.DLQ &&
        !(input.ignoreQueues ?? []).includes(stat.queue) &&
        stat.consumers === 0,
    )
    .map((stat) => stat.queue);

  const problems: string[] = [];
  if (heartbeats.worker.state !== 'up') {
    problems.push(
      `worker is ${heartbeats.worker.state}: emails, notifications and other queued work are not being processed`,
    );
  }
  if (heartbeats.jobs.state !== 'up') {
    problems.push(
      `jobs is ${heartbeats.jobs.state}: scheduled jobs (unpaid-order cancellation, reminders, cleanups) are not running`,
    );
  }
  if (queuesWithoutConsumers.length > 0) {
    problems.push(`no consumer on: ${queuesWithoutConsumers.join(', ')}`);
  }
  return {
    ok: problems.length === 0,
    heartbeats,
    queuesWithoutConsumers,
    problems,
  };
}

/**
 * Makes the worker and jobs programs observable. Each sends a heartbeat to
 * Redis every 30 s; any process can read them. This turns "nothing shows an
 * error" into a visible failure (health endpoint, metric, alert, startup log).
 */
@Injectable()
export class HeartbeatService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(HeartbeatService.name);
  private timer: NodeJS.Timeout | null = null;
  private graceTimer: NodeJS.Timeout | null = null;

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
    @Optional() private readonly rabbitmq?: RabbitMQService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.redis) return;
    const targets = heartbeatTargets();
    if (targets.length > 0) {
      void this.beat(targets);
      this.timer = setInterval(
        () => void this.beat(targets),
        HEARTBEAT_INTERVAL_MS,
      );
      this.timer.unref();
    }
    // The API warns loudly if, after a grace period, the programs it relies
    // on are not running (for example a server that only started the api).
    if (roleCan('http') && !roleCan('consumers')) {
      this.graceTimer = setTimeout(
        () => void this.warnIfMissing(),
        STARTUP_GRACE_MS,
      );
      this.graceTimer.unref();
    }
  }

  private async beat(targets: BackgroundTarget[]): Promise<void> {
    const redis = this.redis;
    if (!redis) return;
    try {
      const now = String(Date.now());
      await Promise.all(
        targets.map((target) =>
          redis.set(key(target), now, 'EX', HEARTBEAT_TTL_SECONDS),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Heartbeat write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async age(target: BackgroundTarget): Promise<number | null> {
    if (!this.redis) return null;
    try {
      const value = await this.redis.get(key(target));
      if (!value) return null;
      const written = Number(value);
      return Number.isFinite(written)
        ? Math.max(0, (Date.now() - written) / 1000)
        : null;
    } catch {
      return null;
    }
  }

  async status(): Promise<BackgroundStatus> {
    const [worker, jobs, queueStats] = await Promise.all([
      this.age('worker'),
      this.age('jobs'),
      this.rabbitmq ? this.rabbitmq.getQueueStats() : Promise.resolve([]),
    ]);
    return evaluateBackground({
      ages: { worker, jobs },
      queueStats: this.rabbitmq?.isAvailable() ? queueStats : null,
      // The workflow-start consumer only runs when Temporal is enabled.
      ignoreQueues: readTemporalConfig().enabled
        ? []
        : [RABBITMQ_QUEUES.WORKFLOWS],
    });
  }

  private async warnIfMissing(): Promise<void> {
    const status = await this.status();
    if (status.ok) return;
    this.logger.error(
      `Background programs are not running: ${status.problems.join('; ')}. ` +
        'Start worker and jobs (docker compose --profile <env> up -d), or set PROCESS_ROLE=all on the api.',
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
  }
}
