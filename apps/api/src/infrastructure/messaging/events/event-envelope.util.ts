import { PermanentConsumerError } from '../rabbitmq/consumer-retry.util';
import type {
  EventActor,
  EventEnvelope,
  PublishEventInput,
} from './event-envelope.types';

/**
 * `<aggregate>.<fact>`: lower-case, the aggregate first, then the past-tense fact in snake_case.
 * `order.shipped`, `user.login_from_new_device`, `referral.reward_credited`.
 */
export const EVENT_TYPE_PATTERN =
  /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export function isValidEventType(type: string): boolean {
  return EVENT_TYPE_PATTERN.test(type);
}

const SYSTEM_ACTOR: EventActor = { type: 'system' };

/** Builds the envelope for a new event. Throws on a type that breaks the naming rule. */
export function buildEnvelope<T>(
  input: PublishEventInput<T>,
  context: { eventId: string; requestId?: string },
): EventEnvelope<T> {
  if (!isValidEventType(input.type)) {
    throw new Error(
      `Event type "${input.type}" must be <aggregate>.<fact> in lower case, for example "order.shipped".`,
    );
  }
  return {
    eventId: context.eventId,
    type: input.type,
    version: input.version ?? 1,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    aggregate: input.aggregate,
    actor: input.actor ?? SYSTEM_ACTOR,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    payload: input.payload,
  };
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const aggregate = v.aggregate as Record<string, unknown> | undefined;
  return (
    typeof v.eventId === 'string' &&
    typeof v.type === 'string' &&
    typeof v.version === 'number' &&
    typeof v.occurredAt === 'string' &&
    typeof aggregate?.type === 'string' &&
    typeof aggregate?.id === 'string' &&
    typeof v.actor === 'object' &&
    v.actor !== null &&
    typeof v.payload === 'object' &&
    v.payload !== null
  );
}

/**
 * For a consumer's first line: returns the envelope, or throws a permanent error (a message that
 * is not an envelope can never succeed, so it goes straight to the dead-letter queue).
 * Pass `supportedVersions` to refuse a payload version the consumer cannot read.
 */
export function parseEnvelope<T = Record<string, unknown>>(
  raw: unknown,
  options: {
    type?: string | readonly string[];
    supportedVersions?: readonly number[];
  } = {},
): EventEnvelope<T> {
  if (!isEventEnvelope(raw)) {
    throw new PermanentConsumerError('Message is not an event envelope');
  }
  const types = options.type
    ? Array.isArray(options.type)
      ? options.type
      : [options.type as string]
    : null;
  if (types && !types.includes(raw.type)) {
    throw new PermanentConsumerError(
      `Unexpected event type "${raw.type}" on this queue`,
    );
  }
  if (
    options.supportedVersions &&
    !options.supportedVersions.includes(raw.version)
  ) {
    throw new PermanentConsumerError(
      `Unsupported version ${raw.version} of ${raw.type}`,
    );
  }
  return raw as EventEnvelope<T>;
}
