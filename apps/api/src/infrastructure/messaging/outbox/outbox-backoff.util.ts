/** How many publish attempts an outbox row gets before it is declared DEAD. */
export const OUTBOX_MAX_ATTEMPTS = 8;

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15 * 60_000;

/**
 * Delay before the next publish attempt: 5 s, 10 s, 20 s ... capped at 15 minutes, with
 * "full jitter" (a random point between half and all of the delay) so rows that failed
 * together do not retry together.
 *
 * `attemptsMade` is the number of attempts including the one that just failed (1 or more).
 */
export function outboxRetryDelayMs(
  attemptsMade: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attemptsMade - 1);
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** exponent);
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}

export function isOutboxExhausted(attemptsMade: number): boolean {
  return attemptsMade >= OUTBOX_MAX_ATTEMPTS;
}
