import { UnauthorizedException } from '@nestjs/common';
import { ROLE } from '@prisma/client';
import { createHmac } from 'crypto';

import { authCookieRoleForPath } from '../constants/auth-cookies.constants';
import { RefreshSessionService } from './refresh-session.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';

const refreshSecret = 'test-refresh-secret';
const hash = (id: string) =>
  createHmac('sha256', refreshSecret).update(id).digest('hex');

const vendor = {
  id: 'vendor-1',
  email: 'v@example.com',
  firstName: 'V',
  lastName: 'Endor',
  isActive: true,
  isApproved: true,
  tokenVersion: 3,
  refreshToken: null,
  refreshTokenId: null,
};

function make(opts: { redisGrace?: string | null } = {}) {
  const prisma = {
    accountAuthSession: {
      create: jest.fn().mockResolvedValue(undefined),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    vendor: {
      findUnique: jest.fn().mockResolvedValue(vendor),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    admin: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const jwt = {
    decode: jest
      .fn()
      .mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    signAsync: jest.fn().mockResolvedValue('signed-token'),
  };
  const config = {
    getOrThrow: jest.fn(
      (key: string) =>
        ({
          JWT_ISSUER: 'nuts-test',
          JWT_ACCESS_AUDIENCE: 'nuts-api',
          JWT_REFRESH_AUDIENCE: 'nuts-refresh',
          JWT_SECRET: 'test-access-secret',
          JWT_REFRESH_SECRET: refreshSecret,
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_EXPIRES_IN: '7d',
        })[key],
    ),
  };
  const redis = {
    get: jest.fn().mockResolvedValue(opts.redisGrace ?? null),
    set: jest.fn().mockResolvedValue('OK'),
  };
  const sessions = {
    invalidateSession: jest.fn(),
    invalidateAccountStamp: jest.fn(),
  };
  const service = new RefreshSessionService(
    prisma as never,
    new TransactionRunnerService(prisma as never, {} as never),
    jwt as never,
    config as never,
    sessions as never,
    redis as never,
  );
  return { service, prisma, redis, sessions };
}

describe('per-device sessions for vendors and admins', () => {
  it('gives every sign-in its own session, so a second device does not replace the first', async () => {
    const { service, prisma } = make();
    const first = await service.issueVendorSession(vendor);
    const second = await service.issueVendorSession(vendor);

    expect(first.tokens.sessionId).toBeDefined();
    expect(first.tokens.sessionId).not.toBe(second.tokens.sessionId);
    expect(prisma.accountAuthSession.create).toHaveBeenCalledTimes(2);
    expect(prisma.accountAuthSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: ROLE.VENDOR,
          subjectId: vendor.id,
          refreshTokenId: first.tokens.refreshId,
        }),
      }),
    );
  });

  it('rotates only the session named in the token', async () => {
    const { service, prisma } = make();
    prisma.accountAuthSession.findUnique.mockResolvedValue({
      id: 's1',
      role: ROLE.VENDOR,
      subjectId: vendor.id,
      tokenVersion: vendor.tokenVersion,
      refreshToken: hash('r1'),
      refreshTokenId: 'r1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const result = await service.refresh({
      sub: vendor.id,
      role: ROLE.VENDOR,
      refreshId: 'r1',
      sessionId: 's1',
    });

    expect(result.tokens.sessionId).toBe('s1');
    expect(prisma.accountAuthSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 's1', refreshTokenId: 'r1' }),
      }),
    );
  });

  it('revokes only the stale session, never the whole account, when a token is reused', async () => {
    const { service, prisma } = make();
    prisma.accountAuthSession.findUnique.mockResolvedValue({
      id: 's1',
      role: ROLE.VENDOR,
      subjectId: vendor.id,
      tokenVersion: vendor.tokenVersion,
      refreshToken: hash('r2'),
      refreshTokenId: 'r2', // the session already moved on to r2
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    await expect(
      service.refresh({
        sub: vendor.id,
        role: ROLE.VENDOR,
        refreshId: 'r1', // stale
        sessionId: 's1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // Only that session row was revoked...
    expect(prisma.accountAuthSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', revokedAt: null },
      }),
    );
    // ...and the account's token version (which signs out EVERY device) is untouched.
    expect(prisma.vendor.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenVersion: expect.anything() }),
      }),
    );
  });

  it('accepts a replay inside the grace window (two tabs refreshing together)', async () => {
    const cached = JSON.stringify({
      user: { id: vendor.id, email: vendor.email },
      tokens: {
        accessToken: 'a',
        refreshToken: 'b',
        refreshId: 'r2',
        sessionId: 's1',
      },
    });
    const { service, prisma } = make({ redisGrace: cached });
    prisma.accountAuthSession.findUnique.mockResolvedValue({
      id: 's1',
      role: ROLE.VENDOR,
      subjectId: vendor.id,
      tokenVersion: vendor.tokenVersion,
      refreshToken: hash('r2'),
      refreshTokenId: 'r2',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const result = await service.refresh({
      sub: vendor.id,
      role: ROLE.VENDOR,
      refreshId: 'r1',
      sessionId: 's1',
    });
    expect(result.tokens.refreshId).toBe('r2');
  });

  it('rejects a revoked session', async () => {
    const { service, prisma } = make();
    prisma.accountAuthSession.findUnique.mockResolvedValue({
      id: 's1',
      role: ROLE.VENDOR,
      subjectId: vendor.id,
      tokenVersion: vendor.tokenVersion,
      refreshToken: hash('r1'),
      refreshTokenId: 'r1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await expect(
      service.refresh({
        sub: vendor.id,
        role: ROLE.VENDOR,
        refreshId: 'r1',
        sessionId: 's1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('signs out one device only', async () => {
    const { service, prisma, sessions } = make();
    await service.revokeAccountSession('s1');
    expect(prisma.accountAuthSession.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(sessions.invalidateSession).toHaveBeenCalledWith('s1');
  });
});

describe('per-role auth cookies', () => {
  it('picks the portal from the request path', () => {
    expect(authCookieRoleForPath('/api/v1/admin/auth/refresh')).toBe('admin');
    expect(authCookieRoleForPath('/api/v1/vendors/auth/refresh')).toBe(
      'vendor',
    );
    expect(authCookieRoleForPath('/api/v1/vendor/discounts')).toBe('vendor');
    expect(authCookieRoleForPath('/api/v1/auth/refresh')).toBe('user');
    expect(authCookieRoleForPath('/api/v1/products')).toBe('user');
    expect(authCookieRoleForPath(undefined)).toBe('user');
  });
});
