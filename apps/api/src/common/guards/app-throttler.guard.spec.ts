import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { AppThrottlerGuard } from './app-throttler.guard';

describe('AppThrottlerGuard', () => {
  const guard = new AppThrottlerGuard(
    [{ ttl: 60_000, limit: 5 }] as never,
    {} as never,
    new Reflector(),
  );
  const detail = (overrides: Record<string, number>) => ({
    limit: 5,
    ttl: 60_000,
    key: 'k',
    tracker: '1.2.3.4',
    totalHits: 6,
    timeToExpire: 42,
    isBlocked: true,
    timeToBlockExpire: 0,
    ...overrides,
  });
  const reject = async (d: ReturnType<typeof detail>) => {
    try {
      await (guard as any).throwThrottlingException({}, d);
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('did not throw');
  };

  it('answers 429 with the seconds really left in the window, not a retry-now hint', async () => {
    const error = await reject(detail({ timeToExpire: 42 }));

    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(error.getResponse()).toEqual({
      message: 'Too many requests. Please wait 42 seconds and try again.',
      retryAfter: 42,
    });
  });

  it('uses the block time when a block is configured', async () => {
    const error = await reject(
      detail({ timeToExpire: 10, timeToBlockExpire: 300 }),
    );

    expect((error.getResponse() as { retryAfter: number }).retryAfter).toBe(
      300,
    );
  });

  it.each([
    [0, 1],
    [0.2, 1],
    [1, 1],
    [59.4, 60],
  ])(
    'never tells a client to wait zero seconds (%p becomes %p)',
    async (left, expected) => {
      const error = await reject(detail({ timeToExpire: left }));

      expect((error.getResponse() as { retryAfter: number }).retryAfter).toBe(
        expected,
      );
    },
  );

  it('says "1 second", not "1 seconds"', async () => {
    const error = await reject(detail({ timeToExpire: 1 }));

    expect((error.getResponse() as { message: string }).message).toBe(
      'Too many requests. Please wait 1 second and try again.',
    );
  });

  describe('as the client finally sees it, through the global error handler', () => {
    it('shows a rate-limit message, the RATE_LIMITED code and a Retry-After header of the real wait', async () => {
      const response = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
      };
      const host = {
        switchToHttp: () => ({
          getResponse: () => response,
          getRequest: () => ({
            method: 'POST',
            path: '/api/v1/auth/refresh',
            ip: '1.2.3.4',
            headers: {},
          }),
        }),
      };
      const filter = new GlobalExceptionFilter({
        get: jest.fn(),
      } as unknown as ConfigService);

      filter.catch(await reject(detail({ timeToExpire: 42 })), host as never);

      expect(response.status).toHaveBeenCalledWith(429);
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '42');
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Too many requests. Please wait 42 seconds and try again.',
          retryAfter: 42,
          error: expect.objectContaining({
            code: 'RATE_LIMITED',
            retryAfter: 42,
          }),
        }),
      );
    });
  });
});
