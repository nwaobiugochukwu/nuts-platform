/**
 * Temporal connection settings, read from the environment.
 *
 *   TEMPORAL_ENABLED    "true" to connect (default false: starting a workflow is a logged no-op)
 *   TEMPORAL_ADDRESS    host:port of the frontend (default localhost:7233; Cloud: <ns>.<acct>.tmprl.cloud:7233)
 *   TEMPORAL_NAMESPACE  nuts-dev | nuts-staging | nuts-prod (default "default")
 *   TEMPORAL_API_KEY    Temporal Cloud API key (enables TLS)
 *   TEMPORAL_TLS        "true" to force TLS without an API key
 */
export interface WorkflowConfig {
  enabled: boolean;
  address: string;
  namespace: string;
  apiKey?: string;
  tls: boolean;
}

export function readWorkflowConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkflowConfig {
  const apiKey = env.TEMPORAL_API_KEY?.trim() || undefined;
  return {
    enabled: env.TEMPORAL_ENABLED?.trim().toLowerCase() === 'true',
    address: env.TEMPORAL_ADDRESS?.trim() || 'localhost:7233',
    namespace: env.TEMPORAL_NAMESPACE?.trim() || 'default',
    apiKey,
    tls: Boolean(apiKey) || env.TEMPORAL_TLS?.trim().toLowerCase() === 'true',
  };
}

/**
 * One task queue per concern so a noisy queue cannot starve payments. Workers
 * poll the queues listed in TEMPORAL_TASK_QUEUES (default: all of them).
 */
export const TASK_QUEUES = {
  default: 'nuts-default',
  payments: 'nuts-payments',
  fulfillment: 'nuts-fulfillment',
  comms: 'nuts-comms',
  lifecycle: 'nuts-lifecycle',
} as const;

export type TaskQueueName = keyof typeof TASK_QUEUES;

export function queuesToPoll(env: NodeJS.ProcessEnv = process.env): string[] {
  const requested = (env.TEMPORAL_TASK_QUEUES ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (requested.length === 0) return Object.values(TASK_QUEUES);
  const known = new Map<string, string>(
    Object.entries(TASK_QUEUES).map(([name, queue]) => [name, queue]),
  );
  return requested.map((name) => {
    const queue =
      known.get(name) ??
      (Object.values(TASK_QUEUES) as string[]).find((q) => q === name);
    if (!queue) {
      throw new Error(
        `Unknown task queue "${name}" in TEMPORAL_TASK_QUEUES. Known: ${Object.keys(TASK_QUEUES).join(', ')}.`,
      );
    }
    return queue;
  });
}
