import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // The API serves JSON. Give it a deny-by-default policy; Swagger is a
    // same-origin development tool and needs inline bootstrap code only.
    const isSwagger = req.path.startsWith('/api/docs');
    res.setHeader(
      'Content-Security-Policy',
      isSwagger
        ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );

    // HTTP Strict Transport Security (HSTS) - only in production
    if (process.env.NODE_ENV === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
    }

    // X-Content-Type-Options
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // X-Frame-Options
    res.setHeader('X-Frame-Options', 'DENY');

    // Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions Policy (formerly Feature Policy)
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()',
    );

    // Cross-Origin-Resource-Policy
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // Cross-Origin-Opener-Policy
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    // Cache control for sensitive endpoints
    if (
      req.path.includes('/auth') ||
      req.path.includes('/admin/auth') ||
      req.path.includes('/vendors/auth')
    ) {
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private',
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    next();
  }
}
