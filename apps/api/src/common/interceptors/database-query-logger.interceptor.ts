import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class DatabaseQueryLoggerInterceptor implements NestInterceptor<
  unknown,
  unknown
> {
  private readonly logger = new Logger(DatabaseQueryLoggerInterceptor.name);
  private readonly SLOW_QUERY_THRESHOLD = 500; // 500ms

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          if (duration > this.SLOW_QUERY_THRESHOLD) {
            this.logger.warn(
              `Slow database operation detected: ${duration}ms - ${context.getClass().name}.${context.getHandler().name}`,
            );
          }
        },
      }),
    );
  }
}
