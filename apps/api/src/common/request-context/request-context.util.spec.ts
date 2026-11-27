import { randomUUID } from 'node:crypto';
import {
  currentClient,
  currentRequestId,
  runWithRequestId,
  sanitizeRequestId,
} from './request-context.util';
import { RequestContextMiddleware } from './request-context.middleware';

describe('request context', () => {
  it('carries the caller (browser and address) to everything the request touches', () => {
    expect(currentClient()).toBeUndefined();
    const seen = runWithRequestId(
      'req-client-0001',
      async () => {
        await Promise.resolve();
        return currentClient();
      },
      { userAgent: 'Mozilla/5.0 test', ip: '41.58.1.2' },
    );
    return expect(seen).resolves.toEqual({
      userAgent: 'Mozilla/5.0 test',
      ip: '41.58.1.2',
    });
  });

  it('has no caller in a worker, where there is no HTTP request', () => {
    expect(
      runWithRequestId('req-worker-0001', () => currentClient()),
    ).toBeUndefined();
  });

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

  it('puts the browser and address of the request into the context, trimming a huge agent', () => {
    const captured: unknown[] = [];
    new RequestContextMiddleware().use(
      {
        id: 'pino-request-id-2',
        headers: { 'user-agent': 'x'.repeat(1000) },
        ip: '102.1.1.1',
      } as never,
      { getHeader: () => undefined } as never,
      () => captured.push(currentClient()),
    );

    expect(captured[0]).toEqual({
      userAgent: 'x'.repeat(300),
      ip: '102.1.1.1',
    });
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
