import type { NextFunction, Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import type { MetricsService } from './metrics.service';

/** Label used when no route matched, so arbitrary URLs cannot create unlimited series. */
export const UNMATCHED_ROUTE = 'unmatched';

/** Probes and long-lived streams would only add noise (or one huge "request"). */
export function isUntracked(path: string, accept?: string): boolean {
  return (
    path.includes('/health') ||
    path.includes('/sse') ||
    path.includes('/metrics') ||
    Boolean(accept?.includes('text/event-stream'))
  );
}

/**
 * Records every HTTP response, including ones rejected by middleware or guards
 * (401, 403, 429, bot blocks), which an interceptor would never see. Install
 * early so it wraps everything after it.
 */
export function createHttpMetricsMiddleware(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isUntracked(req.path ?? '', req.headers?.accept)) {
      next();
      return;
    }
    const start = performance.now();
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      const route =
        (req.route as { path?: string } | undefined)?.path ?? UNMATCHED_ROUTE;
      metrics.observeHttp(
        req.method,
        route,
        res.statusCode,
        (performance.now() - start) / 1000,
      );
    };
    // 'finish' = fully sent; 'close' covers clients that disconnect first.
    res.once('finish', record);
    res.once('close', record);
    next();
  };
}
