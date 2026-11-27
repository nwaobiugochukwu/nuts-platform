import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  AUTH_COOKIE_NAMES,
  authCookieRoleForPath,
  type AuthCookieRole,
} from '../../constants/auth-cookies.constants';
import { AuthSessionService } from '../../services/auth-session.service';
import type { JwtPayload } from '../../types/jwt-payload.types';
import { jwtFromCookie } from '../../utils/jwt-cookie.extractor';

function extractAccessToken(req: Request): string | null {
  if (!req) return null;

  // 1. Authorization: Bearer <token> header (Standard API contract)
  const authHeader = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (authHeader) return authHeader;

  // 2. HttpOnly cookie. The portal in the URL picks which role's cookie is tried
  // first; the others are fallbacks (role guards still decide access).
  const hint = authCookieRoleForPath(req.originalUrl ?? req.url);
  const order: AuthCookieRole[] = [
    hint,
    ...(['user', 'vendor', 'admin'] as const).filter((role) => role !== hint),
  ];
  for (const role of order) {
    const token = jwtFromCookie(AUTH_COOKIE_NAMES[role].access)(req);
    if (token) return token;
  }
  const legacy = jwtFromCookie('access_token')(req);
  if (legacy) return legacy;

  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly authSessionService: AuthSessionService,
  ) {
    super({
      jwtFromRequest: extractAccessToken,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      issuer: config.getOrThrow<string>('JWT_ISSUER'),
      audience: config.getOrThrow<string>('JWT_ACCESS_AUDIENCE'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload) {
    return this.authSessionService.validateAccessToken(payload);
  }
}
