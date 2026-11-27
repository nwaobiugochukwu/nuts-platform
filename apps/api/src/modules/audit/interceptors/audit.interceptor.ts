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
import { currentProcessRole } from '@api/config/process-role';
import { currentRequestId } from '@api/common/request-context/request-context';
import {
  extractIpAddress,
  extractUserAgent,
} from '@api/common/utils/request.util';
import {
  AUDIT_METADATA,
  type AuditContext,
  type AuditOptions,
} from '../decorators/audit.decorator';
import { currentAuditDetails } from '../utils/audit-details.util';
import { AuditLogService } from '../services/audit-log.service';
import { buildAuditEvent } from '../../../infrastructure/messaging/events/audit-event.util';

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Adds the actor record to an object payload (other payload shapes are left alone). */
function withActor(payload: unknown, actor: Record<string, unknown>): unknown {
  if (Object.keys(actor).length === 0) return payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>), ...actor };
  }
  return payload === undefined ? actor : { value: payload, ...actor };
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
          if (options.failureOnly) return;
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
      const details = currentAuditDetails();
      const entityId =
        details?.entityId ??
        (typeof options.entityId === 'function'
          ? options.entityId(ctx)
          : options.entityId
            ? firstValue(ctx.params[options.entityId])
            : undefined);
      const role = request.user?.role;
      const isAdmin = role === 'ADMIN';
      // audit_logs.userId and adminId reference the User and Admin tables, so a
      // vendor's id cannot go in either; it is recorded in the payload instead.
      const adminId =
        details?.adminId ?? (isAdmin ? request.user?.id : undefined);
      const userId =
        details?.userId ?? (role === 'USER' ? request.user?.id : undefined);
      const actor =
        role === 'VENDOR' && request.user
          ? { actor: { role, id: request.user.id } }
          : {};
      this.audit.record(
        buildAuditEvent({
          action:
            details?.action ??
            (outcome === 'failure' && options.failureAction
              ? options.failureAction
              : options.action),
          entity: options.entity,
          entityId,
          adminId,
          userId,
          ipAddress: extractIpAddress(request),
          userAgent: extractUserAgent(request),
          requestId: request.id ? String(request.id) : currentRequestId(),
          outcome,
          statusCode,
          source: currentProcessRole(),
          payload: withActor(
            details?.payload ??
              (options.payload
                ? options.payload(ctx)
                : { params: ctx.params, body: ctx.body }),
            actor,
          ),
          before: details?.before,
          after:
            details?.after ?? (options.after ? options.after(ctx) : undefined),
        }),
      );
      for (const extra of details?.extra ?? []) {
        this.audit.record(
          buildAuditEvent({
            ...extra,
            adminId: extra.adminId ?? adminId,
            userId: extra.userId ?? userId,
            ipAddress: extractIpAddress(request),
            userAgent: extractUserAgent(request),
            requestId: request.id ? String(request.id) : currentRequestId(),
            outcome,
            statusCode,
            source: currentProcessRole(),
          }),
        );
      }
    } catch {
      // Swallowed on purpose; see the method comment.
    }
  }
}
