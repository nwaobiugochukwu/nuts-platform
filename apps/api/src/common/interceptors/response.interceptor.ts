import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';

import { Reflector } from '@nestjs/core';

import { map, Observable } from 'rxjs';

import { BYPASS_RESPONSE_INTERCEPTOR_KEY } from '@api/common/decorators/bypass-response-interceptor.decorator';
import { MESSAGE_KEY } from '@api/common/decorators/message.decorator';

import {
  ApiResponseDto,
  PaginationMetaDto,
} from '@api/common/dto/api-response.dto';

type PaginatedPayload<T> = {
  data: T[];
  meta: PaginationMetaDto;
};

type PaginatedResultsPayload<T> = {
  results: T[];
  pagination: PaginationMetaDto;
};

function isPaginatedPayload(
  value: unknown,
): value is PaginatedPayload<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return Array.isArray(record.data) && 'meta' in record;
}

function isPaginatedResultsPayload(
  value: unknown,
): value is PaginatedResultsPayload<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    Array.isArray(record.results) &&
    typeof record.pagination === 'object' &&
    record.pagination !== null
  );
}

function isApiResponseDto(value: unknown): value is ApiResponseDto<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return typeof record.success === 'boolean';
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponseDto<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponseDto<T>> {
    const bypass = this.reflector.getAllAndOverride<boolean>(
      BYPASS_RESPONSE_INTERCEPTOR_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (bypass) {
      return next.handle() as Observable<ApiResponseDto<T>>;
    }

    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest<import('express').Request>();
    const acceptHeader = req?.headers?.accept;
    const res = httpContext.getResponse<import('express').Response>();
    const contentType =
      typeof res?.getHeader === 'function'
        ? (res.getHeader('content-type') as string | undefined)
        : undefined;

    // Protocol-level bypass: do not wrap streaming event protocols
    if (
      acceptHeader?.includes('text/event-stream') ||
      contentType?.includes('text/event-stream')
    ) {
      return next.handle() as Observable<ApiResponseDto<T>>;
    }

    const message =
      this.reflector.getAllAndOverride<string>(MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || 'Request successful';

    return next.handle().pipe(
      map((data: unknown): ApiResponseDto<T> => {
        const timestamp = new Date().toISOString();

        if (isApiResponseDto(data)) {
          const existing = data as ApiResponseDto<T> & { timestamp?: string };
          return {
            ...existing,
            timestamp: existing.timestamp ?? timestamp,
          };
        }

        if (data === null || data === undefined) {
          return {
            success: true,
            message,
            data: null,
            timestamp,
          };
        }

        if (isPaginatedPayload(data)) {
          return {
            success: true,
            message,
            data: data.data as T,
            meta: data.meta,
            timestamp,
          };
        }

        if (isPaginatedResultsPayload(data)) {
          return {
            success: true,
            message,
            data: data.results as T,
            meta: data.pagination,
            timestamp,
          };
        }

        return {
          success: true,
          message,
          data: data as T,
          timestamp,
        };
      }),
    );
  }
}
