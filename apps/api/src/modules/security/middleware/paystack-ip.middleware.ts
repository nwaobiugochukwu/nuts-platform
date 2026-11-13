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

    const ip = req.ip || req.socket.remoteAddress || '';

    const forwardedFor = req.headers['x-forwarded-for'];
    const rawIp =
      (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) || ip;
    const clientIp =
      (typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : '') || ip;

    if (!this.allowedIps.has(clientIp)) {
      this.logger.warn(
        { ip: clientIp, rawIp, path: req.path },
        'Blocked webhook request from unauthorized IP',
      );
      throw new UnauthorizedException('Invalid webhook source');
    }

    next();
  }
}
