import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AUTH_ACCESS_COOKIE } from '../../constants/auth-cookies.constants';
import { AuthSessionService } from '../../sessions/auth-session.service';
import type { JwtPayload } from '../../types/jwt-payload.type';
import { jwtFromCookie } from '../../utils/jwt-cookie.extractor';

function extractAccessToken(req: Request): string | null {
  if (!req) return null;

  // 1. Authorization: Bearer <token> header (Standard API contract)
  const authHeader = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (authHeader) return authHeader;

  // 2. Standard HttpOnly accessToken cookie
  const cookieToken =
    jwtFromCookie(AUTH_ACCESS_COOKIE)(req) ??
    jwtFromCookie('access_token')(req);
  if (cookieToken) return cookieToken;

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
