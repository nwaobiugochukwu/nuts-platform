import type { INestApplicationContext } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { roleCan, type ProcessRole } from './process-role.config';

/**
 * Cron jobs are registered by the scheduler on startup in every process. Roles
 * that must not run them (api, worker) stop them right after startup. Jobs are
 * idempotent and lock-protected, so the millisecond between registration and
 * stopping is harmless. The outbox relay's interval is deliberately left
 * running everywhere: its claims make duplicate sweeps safe, and it lets any
 * live process drain the outbox.
 */
export function stopCronsUnlessJobsRole(
  app: INestApplicationContext,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (roleCan('crons', env)) return 0;
  let stopped = 0;
  try {
    const registry = app.get(SchedulerRegistry, { strict: false });
    for (const job of registry.getCronJobs().values()) {
      void job.stop();
      stopped += 1;
    }
  } catch {
    // No scheduler in this process: nothing to stop.
  }
  return stopped;
}

export interface WorkerHealthInput {
  role: ProcessRole;
  uptimeSeconds: number;
  brokerRequired: boolean;
  brokerAvailable: boolean;
  startedAt: Date;
}

export interface WorkerHealth {
  status: 'ok' | 'degraded';
  role: ProcessRole;
  uptimeSeconds: number;
  startedAt: string;
  checks: { broker: 'up' | 'down' | 'not_required' };
}

/** Pure so it can be unit-tested; the HTTP wrapper lives in worker.ts. */
export function buildWorkerHealth(input: WorkerHealthInput): WorkerHealth {
  const broker = !input.brokerRequired
    ? 'not_required'
    : input.brokerAvailable
      ? 'up'
      : 'down';
  return {
    status: broker === 'down' ? 'degraded' : 'ok',
    role: input.role,
    uptimeSeconds: input.uptimeSeconds,
    startedAt: input.startedAt.toISOString(),
    checks: { broker },
  };
}
