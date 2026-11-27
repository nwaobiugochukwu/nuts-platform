import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithRequestId, sanitizeRequestId } from './request-context.util';

/**
 * Makes the request id (the one pino-http put in `X-Request-Id`) available to
 * all code the request touches, so queue messages, outbox events and audit
 * events can carry it without every service passing it along.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId =
      sanitizeRequestId((req as Request & { id?: unknown }).id) ??
      sanitizeRequestId(res.getHeader('x-request-id')) ??
      sanitizeRequestId(req.headers['x-request-id']) ??
      randomUUID();
    runWithRequestId(requestId, next);
  }
}
