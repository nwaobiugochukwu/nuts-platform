import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ROLE } from '@prisma/client';
import { Strategy } from 'passport-jwt';
import {
  AUTH_COOKIE_NAMES,
  AUTH_REFRESH_COOKIE,
  authCookieRoleForPath,
} from '../../constants/auth-cookies.constants';
import type { RefreshJwtPayload } from '../../types/refresh-jwt-payload.types';
import { jwtFromCookie } from '../../utils/jwt-cookie.extractor';
import type { Request } from 'express';

function extractRefreshToken(req: Request): string | null {
  if (!req) return null;

  // The refresh endpoint's portal decides which role's cookie is read, so one
  // role can never consume (and rotate) another role's refresh token.
  const role = authCookieRoleForPath(req.originalUrl ?? req.url);
  const own = jwtFromCookie(AUTH_COOKIE_NAMES[role].refresh)(req);
  if (own) return own;

  // Sessions created before per-role cookies carry their token in the shared
  // cookie; the endpoint-role check in the controller rejects it if it belongs
  // to a different role. Customers use this cookie natively.
  return (
    jwtFromCookie(AUTH_REFRESH_COOKIE)(req) ??
    jwtFromCookie('refresh_token')(req)
  );
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: extractRefreshToken,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      issuer: config.getOrThrow<string>('JWT_ISSUER'),
      audience: config.getOrThrow<string>('JWT_REFRESH_AUDIENCE'),
      algorithms: ['HS256'],
    });
  }

  validate(payload: RefreshJwtPayload): RefreshJwtPayload {
    if (
      !Object.values(ROLE).includes(payload.role) ||
      typeof payload.sub !== 'string' ||
      typeof payload.refreshId !== 'string' ||
      (payload.sessionId !== undefined &&
        (typeof payload.sessionId !== 'string' ||
          payload.sessionId.length === 0))
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return payload;
  }
}
