import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { MetricsService, normalizePath } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    // Long-lived SSE streams would record one huge "request"; probes are noise.
    const path = request.path ?? '';
    if (
      path.includes('/health') ||
      path.includes('/sse') ||
      request.headers?.accept?.includes('text/event-stream')
    ) {
      return next.handle();
    }
    const start = performance.now();
    return next.handle().pipe(
      finalize(() => {
        const route =
          (request.route as { path?: string } | undefined)?.path ??
          normalizePath(path);
        this.metrics.observeHttp(
          request.method,
          route,
          response.statusCode,
          (performance.now() - start) / 1000,
        );
      }),
    );
  }
}
