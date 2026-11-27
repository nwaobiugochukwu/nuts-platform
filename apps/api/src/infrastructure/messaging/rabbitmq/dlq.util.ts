import { redactForAudit } from '@api/infrastructure/messaging/events/audit-event.util';
import { RABBITMQ_EXCHANGES, RABBITMQ_QUEUES } from './rabbitmq.constants';

/** A message as returned by amqplib's `channel.get`. */
export interface DeadLetterMessage {
  content: Buffer;
  properties: { headers?: Record<string, unknown> };
}

interface DeathEntry {
  queue?: string;
  reason?: string;
  count?: number;
  time?: { value?: number } | Date;
  'routing-keys'?: string[];
}

export interface DeadLetterInfo {
  /** The work queue the message came from (e.g. q.nuts.emails). */
  originalQueue: string | null;
  /** The routing key to republish with. */
  routingKey: string | null;
  /** rejected (handler failed), expired, maxlen... */
  reason: string | null;
  deaths: number;
  /** How many times this tool already replayed it. */
  replays: number;
  requestId: string | null;
  /** Redacted, truncated body for display. */
  preview: string;
}

/** Stops a poison message from being replayed forever. */
export const MAX_REPLAYS = 3;
export const REPLAY_COUNT_HEADER = 'x-dlq-replays';

function deaths(message: DeadLetterMessage): DeathEntry[] {
  const raw = message.properties.headers?.['x-death'];
  return Array.isArray(raw) ? (raw as DeathEntry[]) : [];
}

export function describeDeadLetter(message: DeadLetterMessage): DeadLetterInfo {
  const entries = deaths(message);
  // The entry for the work queue (not the dead-letter queue itself).
  const origin =
    entries.find(
      (entry) => entry.queue && entry.queue !== RABBITMQ_QUEUES.DLQ,
    ) ?? entries[0];

  let preview = '';
  try {
    const parsed: unknown = JSON.parse(message.content.toString());
    preview = JSON.stringify(redactForAudit(parsed));
  } catch {
    preview = '[not JSON]';
  }
  if (preview.length > 300) preview = `${preview.slice(0, 300)}…`;

  const replays = Number(
    message.properties.headers?.[REPLAY_COUNT_HEADER] ?? 0,
  );
  const requestId = message.properties.headers?.['x-request-id'];
  return {
    originalQueue: origin?.queue ?? null,
    routingKey: origin?.['routing-keys']?.[0] ?? null,
    reason: origin?.reason ?? null,
    deaths: entries.reduce((sum, entry) => sum + (entry.count ?? 1), 0),
    replays: Number.isFinite(replays) ? replays : 0,
    requestId: typeof requestId === 'string' ? requestId : null,
    preview,
  };
}

export type ReplayPlan =
  | {
      allowed: true;
      exchange: string;
      routingKey: string;
      headers: Record<string, unknown>;
    }
  | { allowed: false; reason: string };

/** Decides whether (and how) a dead-lettered message can be replayed. */
export function planReplay(
  message: DeadLetterMessage,
  options: { force?: boolean } = {},
): ReplayPlan {
  const info = describeDeadLetter(message);
  if (!info.routingKey) {
    return {
      allowed: false,
      reason: 'no original routing key in the x-death header',
    };
  }
  if (info.replays >= MAX_REPLAYS && !options.force) {
    return {
      allowed: false,
      reason: `already replayed ${info.replays} times (use --force to try again)`,
    };
  }
  const {
    ['x-death']: _death,
    ['x-first-death-exchange']: _a,
    ['x-first-death-queue']: _b,
    ['x-first-death-reason']: _c,
    ...kept
  } = message.properties.headers ?? {};
  void _death;
  void _a;
  void _b;
  void _c;
  return {
    allowed: true,
    exchange: RABBITMQ_EXCHANGES.TOPIC,
    routingKey: info.routingKey,
    headers: { ...kept, [REPLAY_COUNT_HEADER]: info.replays + 1 },
  };
}
