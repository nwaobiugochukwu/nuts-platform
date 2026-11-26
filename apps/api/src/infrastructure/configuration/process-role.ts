/**
 * Which part of the platform this process runs.
 *
 * The same build runs in several independent processes so that a crash, leak or
 * slow batch job in one cannot stop the others:
 *
 *   all     everything in one process (the default, and what local dev uses)
 *   api     HTTP and SSE only; no scheduled jobs, no queue consumers
 *   worker  RabbitMQ consumers and the outbox relay; no HTTP, no scheduled jobs
 *   jobs    scheduled (cron) jobs only; no HTTP, no queue consumers
 *
 * Every role loads the whole module graph so in-process domain events keep
 * working; roles differ only in what they start.
 */
export const PROCESS_ROLES = ['all', 'api', 'worker', 'jobs'] as const;
export type ProcessRole = (typeof PROCESS_ROLES)[number];

export type ProcessCapability = 'http' | 'consumers' | 'crons';

const CAPABILITIES: Record<ProcessRole, readonly ProcessCapability[]> = {
  all: ['http', 'consumers', 'crons'],
  api: ['http'],
  worker: ['consumers'],
  jobs: ['crons'],
};

export function parseProcessRole(raw: string | undefined | null): ProcessRole {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return 'all';
  if ((PROCESS_ROLES as readonly string[]).includes(value)) {
    return value as ProcessRole;
  }
  throw new Error(
    `Invalid PROCESS_ROLE "${raw}". Expected one of: ${PROCESS_ROLES.join(', ')}.`,
  );
}

export function currentProcessRole(
  env: NodeJS.ProcessEnv = process.env,
): ProcessRole {
  return parseProcessRole(env.PROCESS_ROLE);
}

export function roleCan(
  capability: ProcessCapability,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return CAPABILITIES[currentProcessRole(env)].includes(capability);
}
