import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** The id that follows one request across HTTP, outbox, RabbitMQ and workers. */
  requestId: string;
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
