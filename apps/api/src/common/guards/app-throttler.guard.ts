import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * The rate limiter, answering with a useful error.
 *
 * The stock guard throws a plain-text error, which our error handler used to report as "Internal
 * server error", and it sets `Retry-After: 0` (retry now) because no block duration is configured.
 * A client that believes that retries at once, and the limit never clears. This guard says how many
 * seconds are really left in the current window, in the body and in the `Retry-After` header (the
 * error handler copies `retryAfter` from the body to the header).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(
      1,
      Math.ceil(
        detail.timeToBlockExpire > 0
          ? detail.timeToBlockExpire
          : detail.timeToExpire,
      ),
    );
    throw new HttpException(
      {
        message: `Too many requests. Please wait ${seconds} second${seconds === 1 ? '' : 's'} and try again.`,
        retryAfter: seconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
