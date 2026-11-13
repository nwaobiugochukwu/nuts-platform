import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

export interface GoogleUserPayload {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly oauthClient: OAuth2Client;
  private readonly clientId: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    this.oauthClient = new OAuth2Client(this.clientId);
  }

  /**
   * Cryptographically verifies a Google ID token from frontend Google Identity Services
   * against Google public JWKS certs.
   *
   * Validates:
   * - Signature against Google's rotating public keys
   * - Audience matches configured GOOGLE_CLIENT_ID (when configured)
   * - Issuer is accounts.google.com or https://accounts.google.com
   * - Token is not expired
   * - Email is verified by Google
   */
  async verifyIdToken(idToken: string): Promise<GoogleUserPayload> {
    if (!idToken || typeof idToken !== 'string') {
      throw new BadRequestException('Google ID token is required');
    }

    let payload: TokenPayload | undefined;

    try {
      const ticket = await this.oauthClient.verifyIdToken({
        idToken,
        audience: this.clientId || undefined,
      });
      payload = ticket.getPayload();
    } catch (error: unknown) {
      this.logger.warn(
        `Google ID token verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException('Invalid or expired Google token');
    }

    if (!payload) {
      throw new UnauthorizedException('Empty token payload from Google');
    }

    // Security checks: issuer verification
    const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!payload.iss || !validIssuers.includes(payload.iss)) {
      this.logger.warn(`Invalid Google token issuer: ${payload.iss}`);
      throw new UnauthorizedException('Untrusted token issuer');
    }

    // Security check: email must be present
    if (!payload.email) {
      throw new BadRequestException(
        'Google account must have an associated email address',
      );
    }

    // Security check: email must be verified by Google
    if (!payload.email_verified) {
      throw new UnauthorizedException(
        'Google account email is not verified. Please verify your email with Google first.',
      );
    }

    const email = payload.email.trim().toLowerCase();
    const firstName =
      payload.given_name?.trim() || payload.name?.split(' ')[0] || 'User';
    const lastName =
      payload.family_name?.trim() ||
      payload.name?.split(' ').slice(1).join(' ') ||
      '';
    const avatarUrl = payload.picture ?? null;

    return {
      googleId: payload.sub,
      email,
      firstName,
      lastName,
      avatarUrl,
      emailVerified: payload.email_verified,
    };
  }
}
