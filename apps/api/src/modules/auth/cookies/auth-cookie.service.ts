import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';

import {
  AUTH_COOKIE_NAMES,
  AUTH_COOKIE_PATH,
  type AuthCookieRole,
} from '../constants/auth-cookies.constants';
import type { AuthTokens } from '../types/auth.types';

@Injectable()
export class AuthCookieService {
  private readonly baseOptions: CookieOptions;
  private readonly accessMaxAge: number;
  private readonly refreshMaxAge: number;

  constructor(private readonly config: ConfigService) {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    const isStaging = this.config.get<string>('NODE_ENV') === 'staging';

    const configuredSameSite =
      this.config.get<string>('COOKIE_SAME_SITE') ||
      this.config.get<string>('AUTH_COOKIE_SAME_SITE');

    const defaultSameSite = isProduction || isStaging ? 'none' : 'lax';
    const effectiveSameSite = (configuredSameSite?.toLowerCase() ||
      defaultSameSite) as 'lax' | 'strict' | 'none';

    if (!['lax', 'strict', 'none'].includes(effectiveSameSite)) {
      throw new Error('COOKIE_SAME_SITE must be lax, strict, or none');
    }

    const isSecureConfig =
      this.config.get<string | boolean>('AUTH_COOKIE_SECURE') ??
      this.config.get<string | boolean>('COOKIE_SECURE');

    /**
     * SameSite=None strictly requires Secure per RFC 6265bis.
     * Enforce secure in production/staging or when SameSite is None.
     */
    const secure =
      isSecureConfig !== undefined
        ? String(isSecureConfig) === 'true'
        : effectiveSameSite === 'none' || isProduction || isStaging;

    if (effectiveSameSite === 'none' && !secure) {
      throw new Error('SameSite=None cookies require Secure');
    }

    this.baseOptions = {
      httpOnly: true,
      secure,
      sameSite: effectiveSameSite,
    };

    const rawDomain =
      this.config.get<string>('COOKIE_DOMAIN') ||
      this.config.get<string>('AUTH_COOKIE_DOMAIN');
    const sanitizedDomain = this.sanitizeDomain(rawDomain);

    // Host-Only cookies by default (domain undefined).
    // Only bind domain when explicitly configured in non-production environments.
    if (sanitizedDomain && !isProduction) {
      this.baseOptions.domain = sanitizedDomain;
    }

    this.accessMaxAge = this.msFromExpires(
      this.config.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
    );

    this.refreshMaxAge = this.msFromExpires(
      this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );
  }

  setAuthCookies(
    res: Response,
    tokens: AuthTokens,
    role: AuthCookieRole = 'user',
  ): void {
    const names = AUTH_COOKIE_NAMES[role];

    // 1. HttpOnly access token cookie (this role only)
    res.cookie(names.access, tokens.accessToken, {
      ...this.baseOptions,
      maxAge: this.accessMaxAge,
      path: AUTH_COOKIE_PATH,
    });

    // 2. HttpOnly refresh token cookie (this role only)
    res.cookie(names.refresh, tokens.refreshToken, {
      ...this.baseOptions,
      maxAge: this.refreshMaxAge,
      path: AUTH_COOKIE_PATH,
    });
  }

  clearAuthCookies(res: Response, role: AuthCookieRole = 'user'): void {
    const names = AUTH_COOKIE_NAMES[role];
    res.clearCookie(names.access, {
      ...this.baseOptions,
      path: AUTH_COOKIE_PATH,
    });
    res.clearCookie(names.refresh, {
      ...this.baseOptions,
      path: AUTH_COOKIE_PATH,
    });

    // Only the customer cookies may carry the legacy snake_case names; never
    // touch another role's cookies when one role signs out.
    if (role === 'user') {
      res.clearCookie('access_token', {
        ...this.baseOptions,
        path: AUTH_COOKIE_PATH,
      });
      res.clearCookie('refresh_token', {
        ...this.baseOptions,
        path: AUTH_COOKIE_PATH,
      });
    }
  }

  private msFromExpires(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value.trim());

    if (!match) {
      throw new Error(
        `Invalid JWT expiration format: "${value}". Expected values such as 15m or 7d.`,
      );
    }

    const amount = Number(match[1]);
    const unit = match[2];

    const multipliers = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    } as const;

    return amount * multipliers[unit as keyof typeof multipliers];
  }

  /**
   * Sanitizes the configured cookie domain.
   * Strips protocols (http://, https://), ports (:5173), and paths.
   * Returns undefined for localhost / 127.0.0.1 to allow RFC-compliant host-only cookies.
   */
  private sanitizeDomain(rawDomain?: string): string | undefined {
    if (!rawDomain) return undefined;
    let domain = rawDomain.trim();

    if (domain.includes('://')) {
      try {
        domain = new URL(domain).hostname;
      } catch {
        domain = domain.replace(/^https?:\/\//i, '');
      }
    }

    domain = domain.split(':')[0].split('/')[0].trim();

    if (!domain || domain === 'localhost' || domain === '127.0.0.1') {
      return undefined;
    }

    return domain;
  }
}
