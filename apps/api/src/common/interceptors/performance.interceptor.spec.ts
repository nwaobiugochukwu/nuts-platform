import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import {
  recordCacheLookup,
  recordDbQuery,
  runWithRequestId,
} from '@api/common/request-context/request-context.util';
import { PerformanceInterceptor } from './performance.interceptor';

describe('PerformanceInterceptor (Slow ms & Server-Timing)', () => {
  let interceptor: PerformanceInterceptor;
  let mockContext: ExecutionContext;
  let mockCallHandler: CallHandler;
  let mockRequest: any;
  let mockResponse: any;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new PerformanceInterceptor();

    mockRequest = {
      method: 'GET',
      path: '/api/v1/products',
    };

    mockResponse = {
      headersSent: false,
      setHeader: jest.fn(),
    };

    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    mockCallHandler = {
      handle: jest.fn(() => of({ data: 'ok' })),
    };

    loggerWarnSpy = jest
      .spyOn((interceptor as any).logger, 'warn')
      .mockImplementation();
    loggerErrorSpy = jest
      .spyOn((interceptor as any).logger, 'error')
      .mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * [Performance / Latency Tracking]
   * Verifies that every HTTP response is tagged with Server-Timing: app;dur=...
   * to enable client & APM latency observability.
   */
  it('attaches Server-Timing header to successful responses', (done) => {
    interceptor.intercept(mockContext, mockCallHandler).subscribe({
      next: () => {
        expect(mockResponse.setHeader).toHaveBeenCalledWith(
          'Server-Timing',
          expect.stringMatching(/^app;dur=\d+$/),
        );
        done();
      },
    });
  });

  /*
   * [Performance / Where the time went]
   * The Server-Timing header and the slow-request log carry the database and cache work
   * recorded during the request, so a slow page can be explained from one log line.
   */
  it('adds database time to Server-Timing and cache counts to the slow log', (done) => {
    runWithRequestId('req-timings-1', () => {
      recordDbQuery(40);
      recordDbQuery(60);
      recordCacheLookup(true);
      recordCacheLookup(false);
      recordCacheLookup(false);
      const nowSpy = jest
        .spyOn(performance, 'now')
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(300);

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        complete: () => {
          nowSpy.mockRestore();
          expect(mockResponse.setHeader).toHaveBeenCalledWith(
            'Server-Timing',
            'app;dur=300, db;dur=100;desc="2 queries"',
          );
          expect(loggerWarnSpy).toHaveBeenCalledWith(
            'SLOW REQUEST (>199ms): GET /api/v1/products - 300ms [db 100ms in 2 queries, cache 1 hits 2 misses]',
          );
          done();
        },
      });
    });
  });

  /*
   * [Performance / Slow Request Warning]
   * Detects slow requests (>199ms) and logs a warning with method, path, and duration.
   */
  it('logs a warning when request execution exceeds the 199ms threshold', () => {
    // Test the private logPerformance method directly with slow duration
    (interceptor as any).logPerformance('GET', '/api/v1/products', 250, false);

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'SLOW REQUEST (>199ms): GET /api/v1/products - 250ms',
      ),
    );
  });

  /*
   * [Performance / Fast Request Normal Operation]
   * Requests completing below 199ms should NOT trigger SLOW REQUEST warnings.
   */
  it('does not log slow request warning when duration is within acceptable latency', () => {
    (interceptor as any).logPerformance('GET', '/api/v1/products', 45, false);

    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });

  /*
   * [Performance / Probe Overhead Elimination]
   * High-frequency health probes (/health) must bypass interceptor timing logic
   * to eliminate CPU and logging overhead on Kubernetes liveness checks.
   */
  it('bypasses performance tracking for health probes', (done) => {
    mockRequest.path = '/api/v1/health';

    interceptor.intercept(mockContext, mockCallHandler).subscribe({
      next: () => {
        expect(mockResponse.setHeader).not.toHaveBeenCalled();
        expect(loggerWarnSpy).not.toHaveBeenCalled();
        done();
      },
    });
  });

  /*
   * [Performance / Error Latency Logging]
   * Verifies that errored requests log the exact duration and error details
   * to diagnose whether database timeouts caused the failure.
   */
  it('logs error with duration when downstream handler throws', (done) => {
    const errorCallHandler: CallHandler = {
      handle: () => throwError(() => new Error('Database pool timeout')),
    };

    interceptor.intercept(mockContext, errorCallHandler).subscribe({
      error: () => {
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('ERROR: Database pool timeout'),
        );
        done();
      },
    });
  });
});
