import {
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ROLE } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import type { StringValue } from 'ms';
import type Redis from 'ioredis';

import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/cache/redis.constants';
import { AuthSessionService } from './auth-session.service';

import {
  ADMIN_REFRESH_SELECT,
  USER_REFRESH_SELECT,
  VENDOR_REFRESH_SELECT,
  type AdminAuthRecord,
  type UserAuthRecord,
  type VendorAuthRecord,
} from '../constants/auth-selects.constants';
import type {
  AuthSession,
  AuthTokens,
  RefreshableAccount,
} from '../types/auth.types';
import type { RefreshJwtPayload } from '../types/refresh-jwt-payload.types';

type RotateRefreshSession = (
  refreshTokenHash: string,
  refreshId: string,
  expectedRefreshId: string,
) => Promise<number>;

@Injectable()
export class RefreshSessionService {
  private readonly logger = new Logger(RefreshSessionService.name);
  private static readonly GRACE_PERIOD_SECONDS = 15; // 15-second network race window (RFC 6819 standard)

  private readonly jwtIssuer: string;
  private readonly accessAudience: string;
  private readonly refreshAudience: string;
  private readonly jwtSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: StringValue;
  private readonly refreshExpiresIn: StringValue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    configService: ConfigService,
    @Optional() private readonly authSessionService?: AuthSessionService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {
    this.jwtIssuer = configService.getOrThrow<string>('JWT_ISSUER');
    this.accessAudience = configService.getOrThrow<string>(
      'JWT_ACCESS_AUDIENCE',
    );
    this.refreshAudience = configService.getOrThrow<string>(
      'JWT_REFRESH_AUDIENCE',
    );
    this.jwtSecret = configService.getOrThrow<string>('JWT_SECRET');
    this.refreshSecret = configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.accessExpiresIn = configService.getOrThrow<string>(
      'JWT_ACCESS_EXPIRES_IN',
    ) as StringValue;
    this.refreshExpiresIn = configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    ) as StringValue;
  }

  async issueUserSession(user: UserAuthRecord): Promise<AuthSession> {
    const sessionId = randomUUID();
    const tokens = await this.generateTokens(
      user.id,
      user.role,
      user.tokenVersion,
      sessionId,
    );

    await this.prisma.userAuthSession.deleteMany({
      where: { userId: user.id, expiresAt: { lte: new Date() } },
    });
    await this.prisma.$transaction(async (tx) => {
      // Keep the legacy pointer updated while older API instances may still run.
      const account = await tx.user.updateMany({
        where: {
          id: user.id,
          isActive: true,
          tokenVersion: user.tokenVersion,
        },
        data: {
          refreshToken: this.hashRefreshToken(tokens.refreshId),
          refreshTokenId: tokens.refreshId,
        },
      });
      if (account.count !== 1) {
        throw new UnauthorizedException(
          'Unable to create authentication session',
        );
      }
      await tx.userAuthSession.create({
        data: {
          id: sessionId,
          userId: user.id,
          tokenVersion: user.tokenVersion,
          refreshToken: this.hashRefreshToken(tokens.refreshId),
          refreshTokenId: tokens.refreshId,
          expiresAt: this.getRefreshExpiresAt(tokens.refreshToken),
        },
      });
    });

    return { user: this.toAuthUserDto(user), tokens };
  }

  /**
   * Issues a new admin session.
   *
   * Every sign-in gets its own AccountAuthSession (refresh token + id), so a
   * second browser or device never invalidates this one. The legacy pointer on
   * the Admin row is still written for API instances that predate sessions.
   */
  async issueAdminSession(admin: AdminAuthRecord): Promise<AuthSession> {
    if (!admin.isActive) {
      throw new UnauthorizedException('Admin account is deactivated');
    }

    const sessionId = randomUUID();
    const tokens = await this.generateTokens(
      admin.id,
      ROLE.ADMIN,
      admin.tokenVersion,
      sessionId,
    );

    await this.createAccountSession(
      ROLE.ADMIN,
      admin.id,
      admin.tokenVersion,
      sessionId,
      tokens,
    );
    await this.writeLegacyPointer(ROLE.ADMIN, admin.id, tokens);

    return { user: this.toAuthUserDto(admin), tokens };
  }

  /**
   * Issues a new vendor session (one AccountAuthSession per sign-in, like admins).
   */
  async issueVendorSession(vendor: VendorAuthRecord): Promise<AuthSession> {
    if (!vendor.isActive) {
      throw new UnauthorizedException('Vendor account is deactivated');
    }

    const sessionId = randomUUID();
    const tokens = await this.generateTokens(
      vendor.id,
      ROLE.VENDOR,
      vendor.tokenVersion,
      sessionId,
    );

    await this.createAccountSession(
      ROLE.VENDOR,
      vendor.id,
      vendor.tokenVersion,
      sessionId,
      tokens,
    );
    await this.writeLegacyPointer(ROLE.VENDOR, vendor.id, tokens);

    return { user: this.toAuthUserDto(vendor), tokens };
  }

  private async createAccountSession(
    role: ROLE,
    subjectId: string,
    tokenVersion: number,
    sessionId: string,
    tokens: AuthTokens,
  ): Promise<void> {
    await this.prisma.accountAuthSession.deleteMany({
      where: { role, subjectId, expiresAt: { lte: new Date() } },
    });
    await this.prisma.accountAuthSession.create({
      data: {
        id: sessionId,
        role,
        subjectId,
        tokenVersion,
        refreshToken: this.hashRefreshToken(tokens.refreshId),
        refreshTokenId: tokens.refreshId,
        expiresAt: this.getRefreshExpiresAt(tokens.refreshToken),
      },
    });
  }

  /** Keeps older API instances (no sessions yet) able to refresh during a rolling deploy. */
  private async writeLegacyPointer(
    role: ROLE,
    subjectId: string,
    tokens: Pick<AuthTokens, 'refreshId'>,
  ): Promise<void> {
    const data = {
      refreshToken: this.hashRefreshToken(tokens.refreshId),
      refreshTokenId: tokens.refreshId,
    };
    try {
      if (role === ROLE.ADMIN) {
        await this.prisma.admin.updateMany({ where: { id: subjectId }, data });
      } else if (role === ROLE.VENDOR) {
        await this.prisma.vendor.updateMany({ where: { id: subjectId }, data });
      }
    } catch (err) {
      this.logger.warn(
        `Legacy refresh pointer update failed: ${(err as Error).message}`,
      );
    }
  }

  /** Signs ONE device out: only this session is revoked, other devices stay signed in. */
  async revokeAccountSession(sessionId: string): Promise<void> {
    await this.prisma.accountAuthSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.authSessionService?.invalidateSession(sessionId);
  }

  async refresh(payload: RefreshJwtPayload): Promise<AuthSession> {
    if (
      !payload.sub ||
      !payload.refreshId ||
      !payload.role ||
      !Object.values(ROLE).includes(payload.role) ||
      (payload.sessionId !== undefined &&
        (typeof payload.sessionId !== 'string' ||
          payload.sessionId.length === 0))
    ) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    switch (payload.role) {
      case ROLE.ADMIN:
        return this.refreshAdmin(payload);
      case ROLE.VENDOR:
        return this.refreshVendor(payload);
      case ROLE.USER:
        return this.refreshUser(payload);
      default:
        throw new UnauthorizedException('Invalid refresh session');
    }
  }

  async revokeSession(
    userId: string,
    role: ROLE,
    activeOnly = false,
  ): Promise<void> {
    const data = {
      refreshToken: null,
      refreshTokenId: null,
      tokenVersion: { increment: 1 },
    };

    if (role === ROLE.ADMIN) {
      await this.prisma.admin.updateMany({
        where: activeOnly ? { id: userId, isActive: true } : { id: userId },
        data,
      });
      await this.revokeAllAccountSessions(role, userId);
      await this.authSessionService?.invalidateAccountStamp(userId, role);
      return;
    }

    if (role === ROLE.VENDOR) {
      await this.prisma.vendor.updateMany({
        where: activeOnly ? { id: userId, isActive: true } : { id: userId },
        data,
      });
      await this.revokeAllAccountSessions(role, userId);
      await this.authSessionService?.invalidateAccountStamp(userId, role);
      return;
    }

    await this.prisma.user.updateMany({
      where: activeOnly ? { id: userId, isActive: true } : { id: userId },
      data,
    });
    await this.authSessionService?.invalidateAccountStamp(userId, role);
  }

  /** Every device of an ADMIN/VENDOR account (password change, deactivation, lock). */
  private async revokeAllAccountSessions(
    role: ROLE,
    subjectId: string,
  ): Promise<void> {
    await this.prisma.accountAuthSession.updateMany({
      where: { role, subjectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeUserSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.userAuthSession.findFirst({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
        },
        select: { refreshTokenId: true },
      });
      if (!session) return;

      const revoked = await tx.userAuthSession.updateMany({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          refreshToken: null,
          refreshTokenId: null,
        },
      });
      if (revoked.count !== 1 || !session.refreshTokenId) return;

      await tx.user.updateMany({
        where: { id: userId, refreshTokenId: session.refreshTokenId },
        data: { refreshToken: null, refreshTokenId: null },
      });
    });

    await this.authSessionService?.invalidateAccountStamp(userId, ROLE.USER);
    await this.authSessionService?.invalidateSession(sessionId);
  }

  /**
   * Revokes ALL active sessions for a user.
   *
   * Used during password reset, password change, and account deactivation
   * to ensure no stale sessions survive the security-critical operation.
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userAuthSession.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          refreshToken: null,
          refreshTokenId: null,
        },
      });

      await tx.user.updateMany({
        where: { id: userId },
        data: {
          refreshToken: null,
          refreshTokenId: null,
          tokenVersion: { increment: 1 },
        },
      });
    });

    await this.authSessionService?.invalidateAccountStamp(userId, ROLE.USER);
  }

  async revokeUserSessionByRefreshToken(
    userId: string,
    refreshToken: string,
  ): Promise<void> {
    let payload: RefreshJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshJwtPayload>(
        refreshToken,
        {
          secret: this.refreshSecret,
          issuer: this.jwtIssuer,
          audience: this.refreshAudience,
          algorithms: ['HS256'],
          ignoreExpiration: true,
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        ['JsonWebTokenError', 'NotBeforeError', 'TokenExpiredError'].includes(
          error.name,
        )
      ) {
        return;
      }
      throw error;
    }

    if (
      payload.sub !== userId ||
      payload.role !== ROLE.USER ||
      typeof payload.refreshId !== 'string'
    ) {
      return;
    }

    const session = payload.sessionId
      ? await this.prisma.userAuthSession.findUnique({
          where: { id: payload.sessionId },
        })
      : await this.prisma.userAuthSession.findUnique({
          where: { refreshTokenId: payload.refreshId },
        });

    if (session?.userId === userId) {
      await this.revokeUserSession(userId, session.id);
    }
  }

  private async refreshAdmin(payload: RefreshJwtPayload): Promise<AuthSession> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
      select: ADMIN_REFRESH_SELECT,
    });

    if (payload.sessionId) {
      return this.rotateAccountSession(admin, payload);
    }

    return this.rotateRefreshSession(
      admin,
      payload,
      async (refreshTokenHash, refreshId, expectedRefreshId) => {
        const result = await this.prisma.admin.updateMany({
          where: {
            id: payload.sub,
            refreshTokenId: expectedRefreshId,
            isActive: true,
          },
          data: { refreshToken: refreshTokenHash, refreshTokenId: refreshId },
        });
        return result.count;
      },
    );
  }

  private async refreshVendor(
    payload: RefreshJwtPayload,
  ): Promise<AuthSession> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: payload.sub },
      select: VENDOR_REFRESH_SELECT,
    });

    if (!vendor?.isApproved) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    if (payload.sessionId) {
      return this.rotateAccountSession(
        { ...vendor, role: ROLE.VENDOR },
        payload,
      );
    }

    return this.rotateRefreshSession(
      { ...vendor, role: ROLE.VENDOR },
      payload,
      async (refreshTokenHash, refreshId, expectedRefreshId) => {
        const result = await this.prisma.vendor.updateMany({
          where: {
            id: payload.sub,
            refreshTokenId: expectedRefreshId,
            isActive: true,
            isApproved: true,
          },
          data: { refreshToken: refreshTokenHash, refreshTokenId: refreshId },
        });
        return result.count;
      },
    );
  }

  private async refreshUser(payload: RefreshJwtPayload): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: USER_REFRESH_SELECT,
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    let session = payload.sessionId
      ? await this.prisma.userAuthSession.findUnique({
          where: { id: payload.sessionId },
        })
      : await this.prisma.userAuthSession.findUnique({
          where: { refreshTokenId: payload.refreshId },
        });

    if (
      !session &&
      !payload.sessionId &&
      user.refreshToken &&
      user.refreshTokenId === payload.refreshId
    ) {
      session = await this.prisma.userAuthSession.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          tokenVersion: user.tokenVersion,
          refreshToken: user.refreshToken,
          refreshTokenId: user.refreshTokenId,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }

    if (
      !session ||
      session.userId !== user.id ||
      (payload.sessionId !== undefined && session.id !== payload.sessionId) ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.tokenVersion !== user.tokenVersion
    ) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    const graceKey = `auth:grace:user:${payload.sub}:${payload.refreshId}`;

    if (session.refreshTokenId !== payload.refreshId || !session.refreshToken) {
      // 1. Concurrency-Safe Grace Period Check (Tier-1 RFC 6819)
      if (this.redis) {
        try {
          const cached = await this.redis.get(graceKey);
          if (cached) {
            this.logger.log(
              `Grace period refresh replay accepted for user ${payload.sub}`,
            );
            return JSON.parse(cached) as AuthSession;
          }
        } catch (err) {
          this.logger.warn(`Grace cache read error: ${(err as Error).message}`);
        }
      }

      // 2. Token reuse detected outside grace window -> Revoke session family!
      this.logger.warn(
        `Token reuse detected for user ${payload.sub} on session ${session.id}. Revoking session.`,
      );
      await this.revokeUserSession(user.id, session.id);
      throw new UnauthorizedException(
        'Security violation: refresh token reuse detected',
      );
    }

    const valid = await this.verifyRefreshTokenHash(
      payload.refreshId,
      session.refreshToken,
    );
    if (!valid) {
      await this.revokeUserSession(user.id, session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(
      user.id,
      user.role,
      user.tokenVersion,
      session.id,
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const sessionUpdate = await tx.userAuthSession.updateMany({
        where: {
          id: session.id,
          userId: user.id,
          tokenVersion: user.tokenVersion,
          refreshTokenId: payload.refreshId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          refreshToken: this.hashRefreshToken(tokens.refreshId),
          refreshTokenId: tokens.refreshId,
          expiresAt: this.getRefreshExpiresAt(tokens.refreshToken),
        },
      });
      if (sessionUpdate.count !== 1) return 0;

      // Older API instances still rotate the account-level refresh pointer.
      const accountUpdate = await tx.user.updateMany({
        where: {
          id: user.id,
          isActive: true,
          tokenVersion: user.tokenVersion,
        },
        data: {
          refreshToken: this.hashRefreshToken(tokens.refreshId),
          refreshTokenId: tokens.refreshId,
        },
      });
      if (accountUpdate.count !== 1) {
        throw new UnauthorizedException('Invalid refresh session');
      }
      return sessionUpdate.count;
    });

    if (updated !== 1) {
      throw new UnauthorizedException(
        'Refresh session has already been rotated',
      );
    }

    const sessionResult: AuthSession = {
      user: this.toAuthUserDto(user),
      tokens,
    };

    // Cache in grace period window so concurrent requests don't fail
    if (this.redis) {
      try {
        await this.redis.set(
          graceKey,
          JSON.stringify(sessionResult),
          'EX',
          RefreshSessionService.GRACE_PERIOD_SECONDS,
        );
      } catch (err) {
        this.logger.warn(`Grace cache write error: ${(err as Error).message}`);
      }
    }

    return sessionResult;
  }

  /**
   * Per-session refresh for ADMIN/VENDOR. Mirrors the customer flow: the token
   * must match THIS session's current refresh id; a replay inside the grace
   * window gets the same result (two tabs refreshing at once), and a stale token
   * revokes only its own session, never the account's other devices.
   */
  private async rotateAccountSession(
    account: RefreshableAccount | null,
    payload: RefreshJwtPayload,
  ): Promise<AuthSession> {
    if (
      !account ||
      account.role !== payload.role ||
      !account.isActive ||
      !payload.sessionId
    ) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    const session = await this.prisma.accountAuthSession.findUnique({
      where: { id: payload.sessionId },
    });
    if (
      !session ||
      session.role !== payload.role ||
      session.subjectId !== account.id ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.tokenVersion !== account.tokenVersion ||
      !session.refreshToken
    ) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    const graceKey = `auth:grace:${payload.role}:${payload.sub}:${payload.refreshId}`;

    if (session.refreshTokenId !== payload.refreshId) {
      if (this.redis) {
        try {
          const cached = await this.redis.get(graceKey);
          if (cached) {
            this.logger.log(
              `Grace period refresh replay accepted for ${payload.role} ${payload.sub}`,
            );
            return JSON.parse(cached) as AuthSession;
          }
        } catch (err) {
          this.logger.warn(`Grace cache read error: ${(err as Error).message}`);
        }
      }

      this.logger.warn(
        `Token reuse detected for ${payload.role} ${payload.sub} on session ${session.id}. Revoking that session only.`,
      );
      await this.revokeAccountSession(session.id);
      throw new UnauthorizedException(
        'Security violation: refresh token reuse detected',
      );
    }

    const valid = await this.verifyRefreshTokenHash(
      payload.refreshId,
      session.refreshToken,
    );
    if (!valid) {
      await this.revokeAccountSession(session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(
      account.id,
      account.role,
      account.tokenVersion,
      session.id,
    );
    const rotated = await this.prisma.accountAuthSession.updateMany({
      where: {
        id: session.id,
        refreshTokenId: payload.refreshId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        refreshToken: this.hashRefreshToken(tokens.refreshId),
        refreshTokenId: tokens.refreshId,
        expiresAt: this.getRefreshExpiresAt(tokens.refreshToken),
      },
    });
    if (rotated.count !== 1) {
      throw new UnauthorizedException(
        'Refresh session has already been rotated',
      );
    }

    await this.writeLegacyPointer(account.role, account.id, tokens);

    const sessionResult: AuthSession = {
      user: this.toAuthUserDto(account),
      tokens,
    };

    if (this.redis) {
      try {
        await this.redis.set(
          graceKey,
          JSON.stringify(sessionResult),
          'EX',
          RefreshSessionService.GRACE_PERIOD_SECONDS,
        );
      } catch (err) {
        this.logger.warn(`Grace cache write error: ${(err as Error).message}`);
      }
    }

    return sessionResult;
  }

  private async rotateRefreshSession(
    account: RefreshableAccount | null,
    payload: RefreshJwtPayload,
    rotate: RotateRefreshSession,
  ): Promise<AuthSession> {
    if (
      !account ||
      account.role !== payload.role ||
      !account.isActive ||
      !account.refreshToken ||
      !account.refreshTokenId
    ) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    const graceKey = `auth:grace:${payload.role}:${payload.sub}:${payload.refreshId}`;

    if (account.refreshTokenId !== payload.refreshId) {
      // 1. Concurrency-Safe Grace Period Check
      if (this.redis) {
        try {
          const cached = await this.redis.get(graceKey);
          if (cached) {
            this.logger.log(
              `Grace period refresh replay accepted for ${payload.role} ${payload.sub}`,
            );
            return JSON.parse(cached) as AuthSession;
          }
        } catch (err) {
          this.logger.warn(`Grace cache read error: ${(err as Error).message}`);
        }
      }

      // 2. Token reuse detected outside grace window -> Revoke session family!
      this.logger.warn(
        `Token reuse detected for ${payload.role} ${payload.sub}. Revoking all sessions.`,
      );
      await this.revokeSession(payload.sub, payload.role, true);
      throw new UnauthorizedException(
        'Security violation: refresh token reuse detected',
      );
    }

    const valid = await this.verifyRefreshTokenHash(
      payload.refreshId,
      account.refreshToken,
    );

    if (!valid) {
      await this.revokeSession(account.id, account.role);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(
      account.id,
      account.role,
      account.tokenVersion,
    );
    const updated = await rotate(
      this.hashRefreshToken(tokens.refreshId),
      tokens.refreshId,
      payload.refreshId,
    );

    if (updated !== 1) {
      throw new UnauthorizedException(
        'Refresh session has already been rotated',
      );
    }

    const sessionResult: AuthSession = {
      user: this.toAuthUserDto(account),
      tokens,
    };

    if (this.redis) {
      try {
        await this.redis.set(
          graceKey,
          JSON.stringify(sessionResult),
          'EX',
          RefreshSessionService.GRACE_PERIOD_SECONDS,
        );
      } catch (err) {
        this.logger.warn(`Grace cache write error: ${(err as Error).message}`);
      }
    }

    return sessionResult;
  }

  private async generateTokens(
    userId: string,
    role: ROLE,
    tokenVersion: number,
    sessionId?: string,
  ): Promise<AuthTokens> {
    const refreshId = randomBytes(32).toString('hex');

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          sub: userId,
          role,
          tokenVersion,
          ...(sessionId ? { sessionId } : {}),
        },
        {
          secret: this.jwtSecret,
          expiresIn: this.accessExpiresIn,
          issuer: this.jwtIssuer,
          audience: this.accessAudience,
        },
      ),
      this.jwtService.signAsync(
        { sub: userId, role, refreshId, ...(sessionId ? { sessionId } : {}) },
        {
          secret: this.refreshSecret,
          expiresIn: this.refreshExpiresIn,
          issuer: this.jwtIssuer,
          audience: this.refreshAudience,
        },
      ),
    ]);

    const expiresIn = this.getAccessExpiresInSeconds(accessToken);

    return {
      accessToken,
      refreshToken,
      refreshId,
      expiresIn,
      tokenType: 'Bearer',
      ...(sessionId ? { sessionId } : {}),
    };
  }

  private getAccessExpiresInSeconds(accessToken: string): number {
    try {
      const payload: unknown = this.jwtService.decode(accessToken);
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'exp' in payload &&
        typeof (payload as { exp: number }).exp === 'number' &&
        'iat' in payload &&
        typeof (payload as { iat: number }).iat === 'number'
      ) {
        return (
          (payload as { exp: number }).exp - (payload as { iat: number }).iat
        );
      }
    } catch {
      // Decode fallback
    }

    return Math.floor(this.msFromExpires(String(this.accessExpiresIn)) / 1000);
  }

  private msFromExpires(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value.trim());
    if (!match) return 900;
    const amount = Number(match[1]);
    const unit = match[2];
    const multipliers = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    } as const;
    const multiplier =
      multipliers[unit as keyof typeof multipliers] ?? multipliers.m;
    return amount * multiplier;
  }

  private getRefreshExpiresAt(refreshToken: string): Date {
    const payload: unknown = this.jwtService.decode(refreshToken);
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('exp' in payload) ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('Generated refresh token is missing its expiry');
    }
    return new Date(payload.exp * 1000);
  }

  private hashRefreshToken(refreshId: string): string {
    return createHmac('sha256', this.refreshSecret)
      .update(refreshId)
      .digest('hex');
  }

  private async verifyRefreshTokenHash(
    refreshId: string,
    storedHash: string,
  ): Promise<boolean> {
    if (storedHash.startsWith('$2')) {
      return bcrypt.compare(refreshId, storedHash);
    }

    const expectedHash = this.hashRefreshToken(refreshId);

    return (
      storedHash.length === expectedHash.length &&
      timingSafeEqual(Buffer.from(storedHash), Buffer.from(expectedHash))
    );
  }

  private toAuthUserDto(account: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }): AuthSession['user'] {
    return {
      id: account.id,
      email: account.email,
      firstName: account.firstName,
      lastName: account.lastName,
    };
  }
}
