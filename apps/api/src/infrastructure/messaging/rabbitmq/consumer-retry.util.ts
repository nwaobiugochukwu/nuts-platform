/**
 * How a failed queue message is handled.
 *
 * - A **permanent** failure (the message can never succeed: unreadable JSON, a malformed
 *   payload, a rejected request) goes straight to the dead-letter queue.
 * - A **transient** failure (database or network trouble, a timeout) is retried after a delay
 *   through a retry queue (10 s, then 1 min, then 10 min). After the last retry it is
 *   dead-lettered.
 * - An **open circuit breaker** means the dependency is down, not that the message is bad: the
 *   message waits a minute and tries again without using up its retry budget, up to
 *   `MAX_CIRCUIT_WAITS` times.
 */

/** Delay of each retry queue, in order. The number of entries is the number of retries. */
export const RETRY_DELAYS_MS = [10_000, 60_000, 600_000] as const;
export const CIRCUIT_WAIT_MS = 60_000;
/** About one hour of waiting on an open breaker before the wait counts as a normal retry. */
export const MAX_CIRCUIT_WAITS = 60;

export const ATTEMPT_HEADER = 'x-nuts-attempt';
export const CIRCUIT_WAITS_HEADER = 'x-nuts-circuit-waits';

/** Throw from a consumer when retrying cannot help, for example a malformed message. */
export class PermanentConsumerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentConsumerError';
  }
}

export type FailureKind = 'permanent' | 'transient' | 'circuit-open';

const PERMANENT_NAMES = new Set([
  'PermanentConsumerError',
  'SyntaxError',
  'PrismaClientValidationError',
  'BadRequestException',
  'UnprocessableEntityException',
  'ValidationError',
]);

export function classifyFailure(error: unknown): FailureKind {
  const name = error instanceof Error ? error.name : '';
  if (name === 'BrokenCircuitError') return 'circuit-open';
  if (PERMANENT_NAMES.has(name)) return 'permanent';
  return 'transient';
}

export type FailureDecision =
  | { action: 'dead'; reason: 'permanent' | 'retries-exhausted' }
  | { action: 'retry'; delayMs: number; attempt: number; circuitWaits: number };

/**
 * What to do with a failed message. `attempt` is how many retries it has already had (0 for
 * the first delivery); `circuitWaits` is how many times it has already waited on a breaker.
 */
export function decideFailure(
  error: unknown,
  attempt: number,
  circuitWaits = 0,
): FailureDecision {
  const kind = classifyFailure(error);
  if (kind === 'permanent') return { action: 'dead', reason: 'permanent' };
  if (kind === 'circuit-open' && circuitWaits < MAX_CIRCUIT_WAITS) {
    return {
      action: 'retry',
      delayMs: CIRCUIT_WAIT_MS,
      attempt,
      circuitWaits: circuitWaits + 1,
    };
  }
  if (attempt >= RETRY_DELAYS_MS.length) {
    return { action: 'dead', reason: 'retries-exhausted' };
  }
  return {
    action: 'retry',
    delayMs: RETRY_DELAYS_MS[attempt],
    attempt: attempt + 1,
    circuitWaits,
  };
}

/** Name of the retry queue for a work queue and a delay, for example `q.nuts.emails.retry.10s`. */
export function retryQueueName(queue: string, delayMs: number): string {
  const label =
    delayMs % 60_000 === 0 ? `${delayMs / 60_000}m` : `${delayMs / 1000}s`;
  return `${queue}.retry.${label}`;
}

/** The retry delays a work queue needs a queue for (the circuit wait reuses the 1-minute one). */
export function retryDelaysFor(): number[] {
  return [...new Set<number>([...RETRY_DELAYS_MS, CIRCUIT_WAIT_MS])];
}

/** How many unacknowledged messages one consumer may hold, per queue. Default 10. */
export const QUEUE_PREFETCH: Record<string, number> = {
  'q.nuts.emails': 5, // each message calls the email provider
  'q.nuts.inventory': 1, // stock changes are applied one at a time
  'q.nuts.workflows': 5,
  'q.nuts.payment-webhooks': 5,
  'q.nuts.analytics': 20, // cheap inserts
  'q.nuts.audit': 20,
};
export const DEFAULT_PREFETCH = 10;

/** A handler that runs longer than this is treated as a transient failure. */
export const HANDLER_TIMEOUT_MS = 30_000;
