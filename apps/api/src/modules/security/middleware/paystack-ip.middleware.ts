import {
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { SECURITY } from '@api/common/constants';

/**
 * Middleware to verify that incoming Paystack webhook requests
 * originate from Paystack's known IP addresses.
 */
@Injectable()
export class PaystackIpMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PaystackIpMiddleware.name);
  private readonly allowedIps: Set<string>;
  private readonly isProduction: boolean;

  constructor(private readonly configService: ConfigService) {
    this.allowedIps = new Set(SECURITY.PAYSTACK_IPS);
    this.isProduction = configService.get<string>('NODE_ENV') === 'production';
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const isTestKey = this.configService
      .get<string>('PAYSTACK_SECRET_KEY')
      ?.startsWith('sk_test_');

    // In non-production or when using test keys for learning/staging, allow all IPs for testing
    if (!this.isProduction || isTestKey) {
      return next();
    }

    const clientIp = this.resolveClientIp(req);

    if (!this.allowedIps.has(clientIp)) {
      this.logger.warn(
        {
          ip: clientIp,
          forwardedFor: req.headers['x-forwarded-for'],
          path: req.path,
        },
        'Blocked webhook request from unauthorized IP',
      );
      throw new UnauthorizedException('Invalid webhook source');
    }

    next();
  }

  /**
   * The address of the caller, taken only from sources a caller cannot forge:
   * the headers the platform edge sets itself (true-client-ip on Render, cf-connecting-ip
   * on Cloudflare; the edge overwrites anything the caller sent), then `req.ip`, which
   * Express resolves against the configured trusted proxies. The leftmost value of
   * `x-forwarded-for` is never used: the caller writes it.
   */
  private resolveClientIp(req: Request): string {
    const edgeHeader = (name: string): string => {
      const value = req.headers[name];
      const raw = Array.isArray(value) ? value[0] : value;
      return typeof raw === 'string' ? raw.trim() : '';
    };
    return (
      edgeHeader('true-client-ip') ||
      edgeHeader('cf-connecting-ip') ||
      req.ip ||
      req.socket.remoteAddress ||
      ''
    );
  }
}
