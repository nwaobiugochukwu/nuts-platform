import { AsyncLocalStorage } from 'node:async_hooks';

/** A second event recorded by the same request (for example an automatic unsuspend during sign-in). */
export interface AuditExtraEvent {
  action: string;
  entity: string;
  entityId?: string;
  userId?: string;
  adminId?: string;
  payload?: Record<string, unknown>;
}

/** Details a service attaches to the audit event of the request it is serving. */
export interface AuditAnnotation {
  /** Overrides the action named on the controller (for example activate vs deactivate). */
  action?: string;
  entityId?: string;
  /** For events whose actor is not signed in yet (a failed login). */
  userId?: string;
  adminId?: string;
  payload?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  /** Additional events to record alongside the main one. */
  extra?: AuditExtraEvent[];
}

export interface RequestContext {
  /** The id that follows one request across HTTP, outbox, RabbitMQ and workers. */
  requestId: string;
  /** Filled by `auditDetails`, read by the audit interceptor after the handler. */
  audit?: AuditAnnotation;
}

/** The mutable context of the current request, if any. */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `requestId` available to everything it calls, awaited or not. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Header carrying the id on RabbitMQ messages. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Accepts only well-formed ids so a message header can never inject odd values into logs. */
export function sanitizeRequestId(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string') return undefined;
  return /^[a-zA-Z0-9_-]{8,64}$/.test(candidate) ? candidate : undefined;
}
