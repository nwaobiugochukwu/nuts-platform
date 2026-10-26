import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import type { Request, Response } from 'express';
import { getPrismaErrorDetail } from '@api/modules/shared/utils/prisma-error.util';

/** Shape returned by NestJS HttpException.getResponse() when validation fails. */
interface HttpExceptionBody {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  retryAfter?: number;
  /** Optional domain error code (UPPER_SNAKE_CASE), e.g. INSUFFICIENT_STOCK. */
  code?: string;
  /** Optional structured, client-safe payload. Only exposed for 4xx responses. */
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

const DOMAIN_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

interface RequestWithActor extends Request {
  user?: { id?: string; sub?: string; role?: string };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly config: ConfigService) {}

  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithActor>();
    const actor = request.user;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] | null = null;
    let errorCode = 'INTERNAL_ERROR';
    let retryAfter: number | undefined;
    let meta: Record<string, unknown> | undefined;

    // HTTP exceptions
    if (exception instanceof HttpException) {
      status = exception.getStatus();

      const res = exception.getResponse() as HttpExceptionBody;
      const rawMessage = res?.message;

      if (
        typeof res === 'object' &&
        res !== null &&
        typeof res.retryAfter === 'number'
      ) {
        retryAfter = res.retryAfter;
        response.setHeader('Retry-After', String(retryAfter));
      }

      if (Array.isArray(rawMessage)) {
        message = rawMessage[0];
        errors = rawMessage;
      } else if (typeof rawMessage === 'string') {
        message = rawMessage;
      } else if (typeof rawMessage === 'object') {
        message = exception.message;
      }

      // Map status codes to error codes
      const errorCodeMap: Record<number, string> = {
        [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
        [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
        [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
        [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
        [HttpStatus.CONFLICT]: 'CONFLICT',
        [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
        [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE',
        [HttpStatus.INTERNAL_SERVER_ERROR]: 'SERVER_ERROR',
        [HttpStatus.BAD_GATEWAY]: 'BAD_GATEWAY',
        [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
      };
      errorCode = errorCodeMap[status] ?? 'HTTP_ERROR';

      /**
       * Domain error codes let clients branch on business conditions
       * (e.g. INSUFFICIENT_STOCK) without parsing human-readable messages.
       * `meta` is restricted to 4xx so internal details never leak on 5xx.
       */
      if (typeof res === 'object' && res !== null) {
        if (
          typeof res.code === 'string' &&
          DOMAIN_ERROR_CODE_PATTERN.test(res.code)
        ) {
          errorCode = res.code;
        }

        if (
          status < 500 &&
          typeof res.meta === 'object' &&
          res.meta !== null &&
          !Array.isArray(res.meta)
        ) {
          meta = res.meta;
        }
      }
    }

    // Prisma exceptions
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = getPrismaErrorDetail(exception);
      status = mapped.status;
      message = mapped.message;
      errorCode = 'DATABASE_ERROR';
      // Log detailed meta for debugging (especially P2003 FK violations)
      if (exception.code === 'P2003' && exception.meta) {
        this.logger.warn(
          `Prisma P2003 detail — field_name: ${JSON.stringify(exception.meta.field_name)}, model_name: ${JSON.stringify(exception.meta.model_name)}, related_model: ${JSON.stringify(exception.meta.related_model || exception.meta.related_model_name)}, constraint: ${JSON.stringify(exception.meta.constraint)}`,
        );
      }
    }

    // Logging
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.path}`,
        exception instanceof Error
          ? exception.stack
          : JSON.stringify(exception),
      );
    } else if (status >= 400) {
      this.logger.warn(
        {
          status,
          method: request.method,
          path: request.path,
          role: actor?.role,
          actorId: actor?.id ?? actor?.sub,
          ip: request.ip,
        },
        'Request rejected',
      );
    }

    const isProduction = this.config.get('NODE_ENV') === 'production';

    response.status(status).json({
      success: false,
      message:
        status >= 500 && isProduction ? 'Internal server error' : message,
      error: {
        code: errorCode,
        ...(errors && !(status >= 500 && isProduction)
          ? { details: errors }
          : {}),
        ...(meta ? { meta } : {}),
        ...(typeof retryAfter === 'number' ? { retryAfter } : {}),
      },
      ...(typeof retryAfter === 'number' ? { retryAfter } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
