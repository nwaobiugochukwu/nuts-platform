import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

/** Wire format of one audit event (published to RabbitMQ and stored in audit_logs). */
export interface AuditEvent {
  /** Idempotency key: the unique eventId column makes redelivery harmless. */
  eventId: string;
  /** When the action happened (ISO 8601), not when the row was written. */
  occurredAt: string;
  action: string;
  entity: string;
  entityId?: string;
  adminId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  outcome?: 'success' | 'failure';
  statusCode?: number;
  /** The process role that recorded it (api, worker, jobs, all). */
  source?: string;
  payload?: Prisma.InputJsonValue;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

export interface BuildAuditEventInput {
  action: string;
  entity: string;
  entityId?: string;
  adminId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  outcome?: 'success' | 'failure';
  statusCode?: number;
  source?: string;
  payload?: unknown;
  before?: unknown;
  after?: unknown;
  eventId?: string;
  occurredAt?: Date;
}

const SENSITIVE_KEY =
  /pass(word|phrase)?|token|secret|authori[sz]ation|cookie|otp|\bpin\b|cvv|cvc|card.?number|account.?number|private.?key|signature|csrf/i;

export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 1_000;

/**
 * Deep-copies a value for storage in the audit trail: secrets are replaced,
 * long strings and large arrays are cut, depth is bounded, and anything that is
 * not plain JSON (functions, symbols, bigint, cycles) is made safe.
 */
export function redactForAudit(
  value: unknown,
  extraSensitiveKeys: readonly string[] = [],
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING
        ? `${value.slice(0, MAX_STRING)}…[truncated]`
        : value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return null;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return null;
  if (depth >= MAX_DEPTH) return '[max depth]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY)
      .map((item) => redactForAudit(item, extraSensitiveKeys, depth + 1, seen));
    if (value.length > MAX_ARRAY) {
      items.push(`[${value.length - MAX_ARRAY} more]`);
    }
    return items;
  }

  const extra = new Set(extraSensitiveKeys.map((key) => key.toLowerCase()));
  const out: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      SENSITIVE_KEY.test(key) || extra.has(key.toLowerCase())
        ? REDACTED
        : redactForAudit(child, extraSensitiveKeys, depth + 1, seen);
  }
  return out;
}

function optionalJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const redacted = redactForAudit(value);
  return redacted === null ? undefined : redacted;
}

export function buildAuditEvent(input: BuildAuditEventInput): AuditEvent {
  return {
    eventId: input.eventId ?? randomUUID(),
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    adminId: input.adminId,
    userId: input.userId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent?.slice(0, 500),
    requestId: input.requestId,
    outcome: input.outcome,
    statusCode: input.statusCode,
    source: input.source,
    payload: optionalJson(input.payload),
    before: optionalJson(input.before),
    after: optionalJson(input.after),
  };
}
