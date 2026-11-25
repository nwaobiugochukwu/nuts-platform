import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { Audit, AUDIT_METADATA, type AuditOptions } from './audit.decorator';
import { AuditInterceptor } from './audit.interceptor';

function contextFor(
  options: AuditOptions | undefined,
  request: Record<string, unknown>,
  statusCode = 200,
): ExecutionContext {
  const handler = () => undefined;
  if (options) Reflect.defineMetadata(AUDIT_METADATA, options, handler);
  return {
    getType: () => 'http',
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

describe('AuditInterceptor', () => {
  let audit: { record: jest.Mock };
  let interceptor: AuditInterceptor;
  const request = {
    id: 'req-1',
    params: { id: 'p-9' },
    query: {},
    body: { name: 'Shoe', password: 'nope' },
    headers: { 'user-agent': 'jest' },
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    user: { id: 'u-1', role: 'USER' },
  };

  beforeEach(() => {
    audit = { record: jest.fn() };
    interceptor = new AuditInterceptor(new Reflector(), audit as never);
  });

  it('records after a successful response without altering it', async () => {
    const ctx = contextFor(
      { action: 'PRODUCT_UPDATED', entity: 'Product', entityId: 'id' },
      request,
      200,
    );
    const result = await lastValueFrom(
      interceptor.intercept(ctx, { handle: () => of({ ok: true }) }),
    );
    expect(result).toEqual({ ok: true });
    expect(audit.record).toHaveBeenCalledTimes(1);
    const event = audit.record.mock.calls[0][0];
    expect(event).toMatchObject({
      action: 'PRODUCT_UPDATED',
      entity: 'Product',
      entityId: 'p-9',
      userId: 'u-1',
      outcome: 'success',
      statusCode: 200,
      requestId: 'req-1',
    });
    expect(event.adminId).toBeUndefined();
    expect(JSON.stringify(event.payload)).toContain('[REDACTED]');
    expect(JSON.stringify(event.payload)).not.toContain('nope');
  });

  it('attributes admin requests to adminId', async () => {
    const ctx = contextFor(
      { action: 'X', entity: 'E' },
      {
        ...request,
        user: { id: 'a-1', role: 'ADMIN' },
      },
    );
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(1) }));
    expect(audit.record.mock.calls[0][0]).toMatchObject({ adminId: 'a-1' });
    expect(audit.record.mock.calls[0][0].userId).toBeUndefined();
  });

  it('does nothing for handlers without @Audit', async () => {
    const ctx = contextFor(undefined, request);
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(1) }));
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not record failures unless asked', async () => {
    const ctx = contextFor({ action: 'X', entity: 'E' }, request);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx, {
          handle: () => throwError(() => new HttpException('no', 403)),
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records 4xx failures when onFailure is set, but not 5xx', async () => {
    const ctx = contextFor(
      { action: 'LOGIN', entity: 'Session', onFailure: true },
      request,
    );
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx, {
          handle: () => throwError(() => new HttpException('no', 401)),
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      outcome: 'failure',
      statusCode: 401,
    });

    audit.record.mockClear();
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx, {
          handle: () => throwError(() => new HttpException('boom', 500)),
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never breaks the request when a resolver throws', async () => {
    const ctx = contextFor(
      {
        action: 'X',
        entity: 'E',
        payload: () => {
          throw new Error('resolver bug');
        },
      },
      request,
    );
    await expect(
      lastValueFrom(interceptor.intercept(ctx, { handle: () => of('fine') })),
    ).resolves.toBe('fine');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('exposes the decorator as metadata', () => {
    class Controller {
      @Audit({ action: 'A', entity: 'E' })
      handler() {}
    }
    expect(
      Reflect.getMetadata(AUDIT_METADATA, Controller.prototype.handler),
    ).toMatchObject({ action: 'A' });
  });
});
