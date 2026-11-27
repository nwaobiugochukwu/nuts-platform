import { randomUUID } from 'node:crypto';
import {
  currentRequestId,
  runWithRequestId,
  sanitizeRequestId,
} from './request-context.util';
import { RequestContextMiddleware } from './request-context.middleware';

describe('request context', () => {
  it('is empty outside a request', () => {
    expect(currentRequestId()).toBeUndefined();
  });

  it('follows async work started inside the request', async () => {
    const seen: Array<string | undefined> = [];
    await runWithRequestId('req-abcdef12', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(currentRequestId());
      await Promise.all([
        Promise.resolve().then(() => seen.push(currentRequestId())),
        new Promise<void>((resolve) =>
          setImmediate(() => {
            seen.push(currentRequestId());
            resolve();
          }),
        ),
      ]);
    });
    expect(seen).toEqual(['req-abcdef12', 'req-abcdef12', 'req-abcdef12']);
    expect(currentRequestId()).toBeUndefined();
  });

  it('keeps concurrent requests apart', async () => {
    const results = await Promise.all(
      ['aaaaaaaa', 'bbbbbbbb'].map((id, index) =>
        runWithRequestId(id, async () => {
          await new Promise((resolve) => setTimeout(resolve, 20 - index * 10));
          return currentRequestId();
        }),
      ),
    );
    expect(results).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });

  it('only accepts well-formed ids', () => {
    expect(sanitizeRequestId('abc12345')).toBe('abc12345');
    expect(sanitizeRequestId(['abc12345', 'x'])).toBe('abc12345');
    expect(sanitizeRequestId('short')).toBeUndefined();
    expect(sanitizeRequestId('has spaces and \n newline')).toBeUndefined();
    expect(sanitizeRequestId('x'.repeat(65))).toBeUndefined();
    expect(sanitizeRequestId(undefined)).toBeUndefined();
    expect(sanitizeRequestId(42)).toBeUndefined();
  });
});

describe('RequestContextMiddleware', () => {
  const run = (req: object, res: object = { getHeader: () => undefined }) => {
    let seen: string | undefined;
    new RequestContextMiddleware().use(req as never, res as never, () => {
      seen = currentRequestId();
    });
    return seen;
  };

  it('uses the id pino-http assigned to the request', () => {
    expect(run({ id: 'pino-request-id-1', headers: {} })).toBe(
      'pino-request-id-1',
    );
  });

  it('falls back to the response header, then the request header, then a new id', () => {
    expect(run({ headers: {} }, { getHeader: () => 'from-response-hdr' })).toBe(
      'from-response-hdr',
    );
    expect(run({ headers: { 'x-request-id': 'from-request-hdr' } })).toBe(
      'from-request-hdr',
    );
    expect(run({ headers: {} })).toMatch(/^[0-9a-f-]{36}$/);
    expect(run({ headers: {} })).not.toBe(randomUUID());
  });
});
