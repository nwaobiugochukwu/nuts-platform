import { EventEmitter } from 'node:events';
import {
  UNMATCHED_ROUTE,
  createHttpMetricsMiddleware,
  isUntracked,
} from './http-metrics.middleware';

function exchange(
  req: Record<string, unknown>,
  statusCode: number,
  event: 'finish' | 'close' = 'finish',
) {
  const observeHttp = jest.fn();
  const middleware = createHttpMetricsMiddleware({ observeHttp } as never);
  const res = Object.assign(new EventEmitter(), { statusCode });
  const next = jest.fn();
  middleware(
    { method: 'GET', headers: {}, ...req } as never,
    res as never,
    next,
  );
  res.emit(event);
  return { observeHttp, next };
}

describe('http metrics middleware', () => {
  it('records the method, matched route, status and duration', () => {
    const { observeHttp, next } = exchange(
      { path: '/api/v1/orders/1', route: { path: '/api/v1/orders/:id' } },
      200,
    );
    expect(next).toHaveBeenCalled();
    expect(observeHttp).toHaveBeenCalledWith(
      'GET',
      '/api/v1/orders/:id',
      200,
      expect.any(Number),
    );
  });

  it('records requests rejected before a route matched, under one fixed label', () => {
    const { observeHttp } = exchange({ path: '/wp-admin/xmlrpc.php' }, 403);
    expect(observeHttp).toHaveBeenCalledWith(
      'GET',
      UNMATCHED_ROUTE,
      403,
      expect.any(Number),
    );
  });

  it('records once even when the connection closes after finishing', () => {
    const observeHttp = jest.fn();
    const middleware = createHttpMetricsMiddleware({ observeHttp } as never);
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    middleware(
      { method: 'GET', path: '/x', headers: {} } as never,
      res as never,
      jest.fn(),
    );
    res.emit('finish');
    res.emit('close');
    expect(observeHttp).toHaveBeenCalledTimes(1);
  });

  it('records a client that disconnects before the response finishes', () => {
    const { observeHttp } = exchange(
      { path: '/slow', route: { path: '/slow' } },
      200,
      'close',
    );
    expect(observeHttp).toHaveBeenCalledTimes(1);
  });

  it('ignores probes, metrics and event streams', () => {
    expect(isUntracked('/api/v1/health')).toBe(true);
    expect(isUntracked('/api/v1/notifications/sse/stream')).toBe(true);
    expect(isUntracked('/metrics')).toBe(true);
    expect(isUntracked('/api/v1/orders', 'text/event-stream')).toBe(true);
    expect(isUntracked('/api/v1/orders')).toBe(false);
    const { observeHttp, next } = exchange({ path: '/api/v1/health' }, 200);
    expect(next).toHaveBeenCalled();
    expect(observeHttp).not.toHaveBeenCalled();
  });
});
