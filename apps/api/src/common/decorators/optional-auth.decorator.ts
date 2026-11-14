import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Marks an endpoint as optional authentication.
 *
 * If a valid JWT is present, `req.user` will be populated by the JwtAuthGuard.
 * If no token is provided or the token is expired/invalid, execution proceeds
 * anonymously without throwing an UnauthorizedException.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
