import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError, type Observable } from 'rxjs';
import {
  Audit,
  AUDIT_METADATA,
  type AuditOptions,
} from '../decorators/audit.decorator';
import { auditAlso, auditDetails } from '../utils/audit-details.util';
import { runWithRequestId } from '@api/common/request-context/request-context.util';
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

  describe('details attached by the service (auditDetails)', () => {
    const run = (
      options: AuditOptions,
      handler: () => Observable<unknown>,
      overrides: Record<string, unknown> = {},
      statusCode = 200,
    ) =>
      runWithRequestId('req-annotated-01', () =>
        lastValueFrom(
          interceptor.intercept(
            contextFor(options, { ...request, ...overrides }, statusCode),
            { handle: handler as never },
          ),
        ).catch(() => undefined),
      );

    it('merges the entity id, payload, before and after into the event', async () => {
      await run({ action: 'CATEGORY_UPDATED', entity: 'Category' }, () => {
        auditDetails({
          entityId: 'cat-7',
          before: { name: 'Old' },
          after: { name: 'New' },
          payload: { changed: ['name'], password: 'nope' },
        });
        return of({ ok: true });
      });
      const event = audit.record.mock.calls[0][0];
      expect(event).toMatchObject({
        action: 'CATEGORY_UPDATED',
        entity: 'Category',
        entityId: 'cat-7',
        before: { name: 'Old' },
        after: { name: 'New' },
      });
      expect(event.payload).toEqual({
        changed: ['name'],
        password: '[REDACTED]',
      });
    });

    it('lets the service refine the action (activate or deactivate)', async () => {
      await run(
        { action: 'CATEGORY_STATUS_CHANGED', entity: 'Category' },
        () => {
          auditDetails({ action: 'CATEGORY_DEACTIVATED', entityId: 'cat-1' });
          return of(1);
        },
      );
      expect(audit.record.mock.calls[0][0].action).toBe('CATEGORY_DEACTIVATED');
    });

    it('records a failed sign-in under the failure action, with the actor the service found', async () => {
      await run(
        {
          action: 'USER_LOGIN',
          failureAction: 'USER_LOGIN_FAILED',
          onFailure: true,
          entity: 'User',
        },
        () => {
          auditDetails({ userId: 'u-found', payload: { email: 'a@b.c' } });
          return throwError(() => new HttpException('bad credentials', 401));
        },
        { user: undefined },
      );
      expect(audit.record.mock.calls[0][0]).toMatchObject({
        action: 'USER_LOGIN_FAILED',
        outcome: 'failure',
        statusCode: 401,
        userId: 'u-found',
        payload: { email: 'a@b.c' },
      });
    });

    it('records extra events next to the main one, with the same request details', async () => {
      await run({ action: 'USER_LOGIN', entity: 'User' }, () => {
        auditDetails({ entityId: 'u-1' });
        auditAlso({
          action: 'USER_AUTO_UNSUSPEND_EXPIRED',
          entity: 'User',
          entityId: 'u-1',
        });
        return of({ ok: true });
      });
      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record.mock.calls[1][0]).toMatchObject({
        action: 'USER_AUTO_UNSUSPEND_EXPIRED',
        entity: 'User',
        entityId: 'u-1',
        userId: 'u-1',
        requestId: 'req-1',
        outcome: 'success',
      });
    });

    it('records only failures when failureOnly is set', async () => {
      const options = {
        action: 'VENDOR_LOGIN',
        failureAction: 'VENDOR_LOGIN_FAILED',
        failureOnly: true,
        onFailure: true,
        entity: 'Vendor',
      } as AuditOptions;
      await run(options, () => of({ token: 'x' }));
      expect(audit.record).not.toHaveBeenCalled();
      await run(options, () => throwError(() => new HttpException('no', 401)));
      expect(audit.record.mock.calls[0][0].action).toBe('VENDOR_LOGIN_FAILED');
    });

    it('records a vendor as the actor in the payload, not in userId (it is not a user row)', async () => {
      await run({ action: 'VENDOR_LOGOUT', entity: 'Vendor' }, () => of(1), {
        user: { id: 'v-1', role: 'VENDOR' },
      });
      const event = audit.record.mock.calls[0][0];
      expect(event.userId).toBeUndefined();
      expect(event.adminId).toBeUndefined();
      expect(event.payload.actor).toEqual({ role: 'VENDOR', id: 'v-1' });
    });

    it('uses the success action when the request succeeds', async () => {
      await run(
        {
          action: 'USER_LOGIN',
          failureAction: 'USER_LOGIN_FAILED',
          onFailure: true,
          entity: 'User',
        },
        () => of({ token: 'x' }),
      );
      expect(audit.record.mock.calls[0][0].action).toBe('USER_LOGIN');
    });
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
