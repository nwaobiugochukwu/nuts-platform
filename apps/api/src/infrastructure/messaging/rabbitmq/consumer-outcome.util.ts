/**
 * Tells the metrics what happened to each queue message, without the messaging code having to
 * depend on the metrics service (which itself reads the broker, so a direct import would be
 * circular). The metrics service subscribes once at start-up.
 */
export type ConsumerOutcome =
  | 'ok'
  | 'retried'
  | 'dead-lettered'
  | 'circuit-wait'
  | 'duplicate-skipped';

export type ConsumerOutcomeListener = (event: {
  queue: string;
  outcome: ConsumerOutcome;
  durationSeconds?: number;
}) => void;

const listeners = new Set<ConsumerOutcomeListener>();

export function onConsumerOutcome(
  listener: ConsumerOutcomeListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordConsumerOutcome(
  queue: string,
  outcome: ConsumerOutcome,
  durationSeconds?: number,
): void {
  for (const listener of listeners) {
    try {
      listener({ queue, outcome, durationSeconds });
    } catch {
      // Metrics must never break message handling.
    }
  }
}
