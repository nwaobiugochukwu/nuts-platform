import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { Observable } from 'rxjs';
import {
  currentTimings,
  type RequestTimings,
} from '@api/common/request-context/request-context.util';
import { tap } from 'rxjs/operators';

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PerformanceInterceptor.name);
  private readonly SLOW_REQUEST_THRESHOLD = 199;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const method = request.method;
    // Exclude query values so searches and other user input never enter logs.
    const url = request.path;

    // Suppress routine health checks and long-lived streaming endpoints (SSE / events) from request-duration logs
    const isSseStream =
      url?.includes('/sse') ||
      url?.includes('/stream') ||
      request.headers?.accept?.includes('text/event-stream');

    if (url?.includes('/health') || isSseStream) {
      return next.handle();
    }

    const start = performance.now();

    const recordDuration = (isError: boolean, error?: unknown) => {
      const duration = Math.round(performance.now() - start);
      const timings = currentTimings();
      if (!response.headersSent) {
        // db is the summed query time, so it can exceed the wall time when queries overlap.
        const db =
          timings && timings.dbQueries > 0
            ? `, db;dur=${Math.round(timings.dbMs)};desc="${timings.dbQueries} queries"`
            : '';
        response.setHeader('Server-Timing', `app;dur=${duration}${db}`);
      }
      this.logPerformance(method, url, duration, isError, error, timings);
    };

    return next.handle().pipe(
      tap({
        next: () => recordDuration(false),
        error: (error: unknown) => recordDuration(true, error),
      }),
    );
  }

  private logPerformance(
    method: string,
    url: string,
    duration: number,
    isError: boolean,
    error?: unknown,
    timings?: RequestTimings,
  ): void {
    const message = `${method} ${url} - ${duration}ms`;

    if (isError) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      this.logger.error(`${message} - ERROR: ${errorMessage}`);
    } else if (duration > this.SLOW_REQUEST_THRESHOLD) {
      this.logger.warn(
        `SLOW REQUEST (>199ms): ${message}${describeTimings(timings)}`,
      );
    }
  }
}

/** " [db 180ms in 4 queries, cache 2 hits 1 miss]" or "" when nothing was recorded. */
function describeTimings(timings?: RequestTimings): string {
  if (!timings) return '';
  const parts: string[] = [];
  if (timings.dbQueries > 0) {
    parts.push(
      `db ${Math.round(timings.dbMs)}ms in ${timings.dbQueries} queries`,
    );
  }
  if (timings.cacheHits + timings.cacheMisses > 0) {
    parts.push(`cache ${timings.cacheHits} hits ${timings.cacheMisses} misses`);
  }
  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
}
