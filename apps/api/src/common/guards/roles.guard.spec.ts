import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE } from '@prisma/client';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const createContext = (user?: { role: ROLE }, path = '/api/v1/orders') =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user, path, originalUrl: path }),
      }),
    }) as unknown as ExecutionContext;

  it('denies vendor tokens on customer-only routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === 'roles' ? [ROLE.USER] : false,
      ),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() =>
      guard.canActivate(createContext({ role: ROLE.VENDOR })),
    ).toThrow(ForbiddenException);
  });

  it('allows a user token on customer-only routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === 'roles' ? [ROLE.USER] : false,
      ),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext({ role: ROLE.USER }))).toBe(true);
  });

  it('defers a public route role check until its route-scoped auth guard runs', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === 'roles' ? [ROLE.ADMIN] : true,
      ),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(
      guard.canActivate(createContext(undefined, '/api/v1/admin/auth/refresh')),
    ).toBe(true);
    expect(
      guard.canActivate(
        createContext({ role: ROLE.ADMIN }, '/api/v1/admin/auth/refresh'),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        createContext({ role: ROLE.VENDOR }, '/api/v1/admin/auth/refresh'),
      ),
    ).toThrow(ForbiddenException);
  });
});
