/** Who caused an event. `system` is a cron, a webhook or any code with no signed-in person. */
export interface EventActor {
  type: 'user' | 'vendor' | 'admin' | 'system';
  id?: string;
}

/**
 * The one shape every domain event has on the broker (docs/architecture/adr/0007).
 *
 * Consumers ignore fields they do not know, so `payload` can grow without breaking them; a change
 * that would break a consumer gets a new `version` (and the consumer handles both while old
 * events are still in flight).
 */
export interface EventEnvelope<T = Record<string, unknown>> {
  /** Unique per event; also the AMQP message id and the key consumers de-duplicate on. */
  eventId: string;
  /** `<aggregate>.<fact>`, past tense: `order.shipped`. Also the routing key. */
  type: string;
  /** Schema version of `payload`, starting at 1. */
  version: number;
  /** When the fact happened (ISO 8601), not when it was published. */
  occurredAt: string;
  aggregate: { type: string; id: string };
  actor: EventActor;
  /** The request that caused it, when there was one. */
  requestId?: string;
  payload: T;
}

export interface PublishEventInput<T = Record<string, unknown>> {
  type: string;
  version?: number;
  aggregate: { type: string; id: string };
  actor?: EventActor;
  occurredAt?: Date;
  payload: T;
}
