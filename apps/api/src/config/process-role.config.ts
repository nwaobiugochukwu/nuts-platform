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

/** The programs that can listen on a health or metrics port. */
export type PortProgram = ProcessRole | 'temporal-worker';
export type PortKind = 'health' | 'metrics';

/** Health ports for programs that have no HTTP API of their own. */
const DEFAULT_HEALTH_PORTS: Partial<Record<PortProgram, number>> = {
  worker: 3002,
  jobs: 3003,
  'temporal-worker': 3004,
};

/** Metrics ports used in local development only; staging turns metrics on explicitly. */
const DEV_METRICS_PORTS: Record<PortProgram, number> = {
  all: 9464,
  api: 9464,
  worker: 9465,
  jobs: 9466,
  'temporal-worker': 9467,
};

function parsePort(name: string, raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `${name} must be a port number between 1 and 65535 (got "${raw}").`,
    );
  }
  return port;
}

/**
 * The port a program uses for its health or metrics endpoint.
 *
 * Lookup order: `{PROGRAM}_{KIND}_PORT` (for example `WORKER_HEALTH_PORT`, which
 * lets one local env file serve every program), then `{KIND}_PORT` (the form a
 * single deployed service uses), then a default. Health has defaults for
 * worker, jobs and temporal-worker; metrics has a default only when
 * NODE_ENV=development, so staging exposes nothing until you set a port.
 * Returns null when there is nothing to listen on.
 */
export function portFor(
  kind: PortKind,
  program: PortProgram,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const names = [program, ...(program === 'all' ? (['api'] as const) : [])].map(
    (name) =>
      `${name.toUpperCase().replace(/-/g, '_')}_${kind.toUpperCase()}_PORT`,
  );
  for (const name of [...names, `${kind.toUpperCase()}_PORT`]) {
    const port = parsePort(name, env[name]);
    if (port !== null) return port;
  }
  if (kind === 'health') return DEFAULT_HEALTH_PORTS[program] ?? null;
  return env.NODE_ENV === 'development' ? DEV_METRICS_PORTS[program] : null;
}
