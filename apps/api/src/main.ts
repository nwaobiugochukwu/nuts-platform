import 'reflect-metadata';
import './instrument';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { BotDetectionMiddleware } from './modules/security/middleware/bot-detection.middleware';
import { CsrfMiddleware } from './modules/security/middleware/csrf.middleware';
import { SecurityHeadersMiddleware } from './modules/security/middleware/security-headers.middleware';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { NormalizeInputPipe } from './common/pipes/normalize-input.pipe';
import { SanitizeHtmlPipe } from './common/pipes/sanitize-html.pipe';
import { setupSwagger } from './swagger.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const logger = app.get(Logger);
  // Express must only trust the private reverse-proxy hops used by the
  // production ingress. This gives req.ip the real client address for limits.
  const expressApp = app
    .getHttpAdapter()
    .getInstance() as import('express').Express;
  expressApp.set('trust proxy', 'loopback, linklocal, uniquelocal');

  // Cloud platform health and liveness probe (e.g. Render HEAD / and GET /)
  expressApp.get('/', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'nuts-api',
      timestamp: new Date().toISOString(),
    });
  });
  expressApp.head('/', (_req, res) => {
    res.status(200).end();
  });

  // Raise the per-response listener ceiling before any middleware attaches its
  // own 'finish' handlers. The default of 10 is a leak-detection heuristic that
  // is too low for a production middleware stack (pino-http + OTel HTTP/Express
  // instrumentation + NestJS platform adapter + compression + end-of-stream Ã—2
  // + Express internals already reaches ~12). We use 25 rather than 0 so that
  // a real listener leak (e.g., a handler that keeps attaching listeners across
  // retries without ever removing them) will still surface as a warning.
  expressApp.use((_req, res, next) => {
    res.setMaxListeners(25);
    next();
  });

  // Install parsers explicitly so request memory use stays bounded. Retain the
  // exact JSON bytes for Paystack's signature check without making a second copy.
  expressApp.use(
    express.json({
      limit: '1mb',
      verify: (request, _response, buffer) => {
        (request as Request & { rawBody?: Buffer }).rawBody = buffer;
      },
    }),
  );
  expressApp.use(
    express.urlencoded({
      extended: false,
      limit: '32kb',
      parameterLimit: 1000,
    }),
  );

  const allowedOrigins =
    config
      .get<string>('ALLOWED_ORIGINS')
      ?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) || [];

  const allowedOriginsSet = new Set(
    allowedOrigins.map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return o;
      }
    }),
  );

  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!requestOrigin) {
        callback(null, true);
        return;
      }

      try {
        const normalized = new URL(requestOrigin).origin;
        if (allowedOriginsSet.has(normalized)) {
          callback(null, true);
          return;
        }
      } catch {
        // Invalid origin format
      }

      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Idempotency-Key',
      'X-Request-Id',
      'x-csrf-token',
      'x-auth-role',
      'x-otp-code',
      'Last-Event-ID',
      'last-event-id',
      'Cache-Control',
    ],
    // Let browser JS read the rotated CSRF token from responses cross-origin.
    exposedHeaders: ['x-csrf-token', 'Server-Timing'],
  });

  app.use(helmet());

  app.use(
    compression({
      threshold: 1024,
      filter: (req: Request, res: Response) => {
        if (
          req.headers.accept?.includes('text/event-stream') ||
          req.path?.includes('notifications/sse/stream') ||
          res
            .getHeader('content-type')
            ?.toString()
            ?.includes('text/event-stream')
        ) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );
  app.use(cookieParser());

  // Apply bot detection as the outermost guard (runs before body parsers and CSRF)
  const botDetection = new BotDetectionMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => {
    botDetection.use(req, res, next);
  });

  // Apply security headers middleware
  const securityHeadersMiddleware = new SecurityHeadersMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => {
    securityHeadersMiddleware.use(req, res, next);
  });

  // Apply CSRF middleware for state-changing operations
  const csrfMiddleware = new CsrfMiddleware(allowedOrigins);
  app.use((req: Request, res: Response, next: NextFunction) => {
    csrfMiddleware.use(req, res, next);
  });

  app.setGlobalPrefix('api/v1');

  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(new ResponseInterceptor(reflector));
  app.useGlobalFilters(new GlobalExceptionFilter(config));
  app.useGlobalPipes(
    new NormalizeInputPipe(),
    new SanitizeHtmlPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // OpenAPI 3.0 / Swagger (strictly enabled in staging and development; prohibited in production)
  setupSwagger(app, config);

  app.enableShutdownHooks();
  const port = config.get<number>('PORT') || 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(
    `Application running on port ${port} (0.0.0.0) [${config.get('NODE_ENV')}]`,
  );
}

bootstrap().catch((error) => {
  console.error('Failed to start application', error);
  process.exit(1);
});
