import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestWithUser } from '@api/common/interfaces/request-with-user.interface';

/**
 * Resolves to `true` ONLY when an authenticated ADMIN sends the
 * `x-cache-bypass: true` header.
 *
 * Centralizes the cache-bypass rule that was previously duplicated inline in
 * every public controller â€” public traffic can never trigger a bypass, since
 * the header alone is not sufficient (an ADMIN user is also required).
 */
export const AdminCacheBypass = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): boolean => {
    const request = ctx.switchToHttp().getRequest<Request & RequestWithUser>();
    return (
      request.headers['x-cache-bypass'] === 'true' &&
      request.user?.role === 'ADMIN'
    );
  },
);
