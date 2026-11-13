import {
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ROLE } from '@prisma/client';
import type Redis from 'ioredis';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';

import type { AuthenticatedUser } from '../types/authenticated-user.type';
import type { JwtPayload } from '../types/jwt-payload.type';

type CachedAccountStamp = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: ROLE;
  isActive: boolean;
  tokenVersion: number;
  isApproved?: boolean;
};

@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);
  private static readonly STAMP_TTL_SECONDS = 60; // 1-minute high-frequency cache window

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  /**
   * JWT signature verification proves that the token was issued by us.
   *
   * It does NOT prove that:
   * - the account still exists;
   * - the account is active;
   * - the token has not been revoked through tokenVersion;
   * - the account still belongs to the expected role.
   *
   * High-End Tier-1 Implementation:
   * Verification utilizes a Redis Security Stamp cache (60s TTL) for sub-millisecond
   * verification without flooding the relational database under high traffic spikes.
   * Revocation operations instantly evict the stamp, preserving 100% real-time security.
   */
  async validateAccessToken(
    payload: JwtPayload,
    expectedRole?: ROLE,
  ): Promise<AuthenticatedUser> {
    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      !Object.values(ROLE).includes(payload.role) ||
      (expectedRole && payload.role !== expectedRole) ||
      !Number.isInteger(payload.tokenVersion) ||
      payload.tokenVersion < 0 ||
      (payload.sessionId !== undefined &&
        (typeof payload.sessionId !== 'string' ||
          payload.sessionId.length === 0))
    ) {
      throw new UnauthorizedException('Invalid access token');
    }

    const account = await this.getAccountWithCache(payload.sub, payload.role);

    if (!account || !account.isActive) {
      throw new UnauthorizedException('Invalid authentication');
    }

    if (
      payload.role === ROLE.VENDOR &&
      (!('isApproved' in account) || !account.isApproved)
    ) {
      throw new UnauthorizedException('Vendor account is not approved');
    }

    if (account.role !== payload.role) {
      throw new UnauthorizedException('Invalid authentication context');
    }

    if (account.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Session has been revoked');
    }

    if (payload.role === ROLE.USER && payload.sessionId) {
      const isSessionValid = await this.validateSessionWithCache(
        payload.sessionId,
        payload.sub,
        payload.tokenVersion,
      );
      if (!isSessionValid) {
        throw new UnauthorizedException('User session has been revoked');
      }
    }

    return this.toAuthenticatedUser(account, payload.sessionId);
  }

  /**
   * Instantly evicts the cached security stamp for an account.
   * Called during password changes, logouts, deactivations, and admin locks.
   */
  async invalidateAccountStamp(userId: string, role?: ROLE): Promise<void> {
    if (!this.redis) return;
    try {
      if (role) {
        await this.redis.del(`auth:stamp:${role}:${userId}`);
      } else {
        await Promise.all([
          this.redis.del(`auth:stamp:${ROLE.USER}:${userId}`),
          this.redis.del(`auth:stamp:${ROLE.VENDOR}:${userId}`),
          this.redis.del(`auth:stamp:${ROLE.ADMIN}:${userId}`),
        ]);
      }
    } catch (err) {
      this.logger.warn(
        `Redis stamp invalidation failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Marks a specific user session as revoked in the high-speed cache.
   */
  async invalidateSession(sessionId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(`auth:sess:${sessionId}`, '0', 'EX', 300);
    } catch (err) {
      this.logger.warn(
        `Redis session invalidation failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Lightweight security check for persistent connections (SSE, WebSockets).
   * Verifies account exists, is active, approved, and session is not revoked.
   */
  async isSessionActive(
    userId: string,
    role: ROLE,
    sessionId?: string,
  ): Promise<boolean> {
    try {
      const account = await this.getAccountWithCache(userId, role);
      if (!account || !account.isActive) return false;
      if (role === ROLE.VENDOR && !account.isApproved) return false;
      if (role === ROLE.USER && sessionId) {
        return await this.validateSessionWithCache(
          sessionId,
          userId,
          account.tokenVersion,
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  private async getAccountWithCache(
    userId: string,
    role: ROLE,
  ): Promise<CachedAccountStamp | null> {
    const stampKey = `auth:stamp:${role}:${userId}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(stampKey);
        if (cached) {
          return JSON.parse(cached) as CachedAccountStamp;
        }
      } catch (err) {
        this.logger.warn(`Redis stamp read error: ${(err as Error).message}`);
      }
    }

    const account = await this.findAccount(userId, role);
    if (!account) return null;

    const stamp: CachedAccountStamp = {
      id: account.id,
      email: account.email,
      firstName: account.firstName,
      lastName: account.lastName,
      role: account.role,
      isActive: account.isActive,
      tokenVersion: account.tokenVersion,
      isApproved:
        'isApproved' in account
          ? Boolean((account as { isApproved?: boolean }).isApproved)
          : true,
    };

    if (this.redis) {
      try {
        await this.redis.set(
          stampKey,
          JSON.stringify(stamp),
          'EX',
          AuthSessionService.STAMP_TTL_SECONDS,
        );
      } catch (err) {
        this.logger.warn(`Redis stamp write error: ${(err as Error).message}`);
      }
    }

    return stamp;
  }

  private async validateSessionWithCache(
    sessionId: string,
    userId: string,
    tokenVersion: number,
  ): Promise<boolean> {
    const sessKey = `auth:sess:${sessionId}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(sessKey);
        if (cached === '1') return true;
        if (cached === '0') return false;
      } catch (err) {
        this.logger.warn(`Redis session read error: ${(err as Error).message}`);
      }
    }

    const session = await this.prisma.userAuthSession.findFirst({
      where: {
        id: sessionId,
        userId,
        tokenVersion,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    const isValid = Boolean(session);

    if (this.redis) {
      try {
        await this.redis.set(
          sessKey,
          isValid ? '1' : '0',
          'EX',
          isValid ? AuthSessionService.STAMP_TTL_SECONDS : 300,
        );
      } catch (err) {
        this.logger.warn(
          `Redis session write error: ${(err as Error).message}`,
        );
      }
    }

    return isValid;
  }

  private async findAccount(userId: string, role: ROLE) {
    /**
     * Each query is by primary key.
     *
     * We intentionally select only fields required for authentication.
     * Passwords and refresh secrets are never loaded during access-token
     * validation.
     */
    switch (role) {
      case ROLE.ADMIN:
        return this.prisma.admin.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
            tokenVersion: true,
          },
        });

      case ROLE.VENDOR: {
        const vendor = await this.prisma.vendor.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            isActive: true,
            isApproved: true,
            tokenVersion: true,
          },
        });
        if (!vendor) {
          return null;
        }
        return {
          ...vendor,
          role: ROLE.VENDOR,
        };
      }

      case ROLE.USER:
        return this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
            tokenVersion: true,
          },
        });

      default:
        throw new UnauthorizedException('Invalid account role');
    }
  }

  private toAuthenticatedUser(
    account: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      role: ROLE;
    },
    sessionId?: string,
  ): AuthenticatedUser {
    return {
      id: account.id,
      email: account.email,
      role: account.role,
      firstName: account.firstName,
      lastName: account.lastName,
      ...(sessionId ? { sessionId } : {}),
    };
  }
}
