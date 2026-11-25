import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { currentProcessRole } from '@api/infrastructure/configuration/process-role';
import {
  extractIpAddress,
  extractUserAgent,
} from '@api/common/utils/request.util';
import {
  AUDIT_METADATA,
  type AuditContext,
  type AuditOptions,
} from './audit.decorator';
import { AuditLogService } from './audit-log.service';
import { buildAuditEvent } from './audit-event';

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type AuditedRequest = Request & {
  id?: string;
  user?: { id: string; role: string; email?: string };
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const options = this.reflector.get<AuditOptions | undefined>(
      AUDIT_METADATA,
      context.getHandler(),
    );
    if (!options) return next.handle();

    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    let recorded = false;

    return next.handle().pipe(
      tap({
        next: (result) => {
          if (recorded) return;
          recorded = true;
          this.safeRecord(
            options,
            request,
            result,
            'success',
            response.statusCode,
          );
        },
        error: (error: unknown) => {
          if (recorded || !options.onFailure) return;
          const status = error instanceof HttpException ? error.getStatus() : 0;
          if (status < 400 || status >= 500) return;
          recorded = true;
          this.safeRecord(options, request, undefined, 'failure', status);
        },
      }),
    );
  }

  /** Auditing must never break or delay the request, whatever a resolver does. */
  private safeRecord(
    options: AuditOptions,
    request: AuditedRequest,
    result: unknown,
    outcome: 'success' | 'failure',
    statusCode: number,
  ): void {
    try {
      const ctx: AuditContext = {
        params: request.params ?? {},
        query: request.query ?? {},
        body: request.body as unknown,
        result,
        user: request.user,
      };
      const entityId =
        typeof options.entityId === 'function'
          ? options.entityId(ctx)
          : options.entityId
            ? firstValue(ctx.params[options.entityId])
            : undefined;
      const isAdmin = request.user?.role === 'ADMIN';
      this.audit.record(
        buildAuditEvent({
          action: options.action,
          entity: options.entity,
          entityId,
          adminId: isAdmin ? request.user?.id : undefined,
          userId: isAdmin ? undefined : request.user?.id,
          ipAddress: extractIpAddress(request),
          userAgent: extractUserAgent(request),
          requestId: request.id ? String(request.id) : undefined,
          outcome,
          statusCode,
          source: currentProcessRole(),
          payload: options.payload
            ? options.payload(ctx)
            : { params: ctx.params, body: ctx.body },
          after: options.after ? options.after(ctx) : undefined,
        }),
      );
    } catch {
      // Swallowed on purpose; see the method comment.
    }
  }
}
