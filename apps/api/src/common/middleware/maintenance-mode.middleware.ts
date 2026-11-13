import {
  Injectable,
  Logger,
  NestMiddleware,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import type { PlatformConfigResponseDto } from '@api/modules/admin/dto/admin-platform-config.dto';

/** Cache key must match the constant in AdminService. */
const PLATFORM_CONFIG_CACHE_KEY = 'platform:config:governance';

/**
 * Routes that remain reachable even when maintenance mode is active.
 *
 * Rules:
 * - Admin APIs so operators can sign in, access controls, and disable maintenance.
 * - Health-check endpoint for load-balancer probes.
 * - Any OPTIONS request (CORS pre-flight).
 *
 * Keep this list as small as possible — every exception is a potential
 * attack surface.
 */
const MAINTENANCE_BYPASS_PREFIXES: readonly string[] = [
  '/api/v1/admin', // admin auth and operator APIs
  '/api/v1/auth/admin', // legacy admin auth route
  '/api/v1/health', // health-check probes
];

function isBypassed(req: Request): boolean {
  if (req.method === 'OPTIONS') return true;

  const path = req.path.toLowerCase().replace(/\/+$/, '') || '/';
  return MAINTENANCE_BYPASS_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

@Injectable()
export class MaintenanceModeMiddleware implements NestMiddleware {
  private readonly logger = new Logger(MaintenanceModeMiddleware.name);

  constructor(private readonly cache: CacheService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    // Fast path: bypass routes skip the cache read entirely.
    if (isBypassed(req)) {
      return next();
    }

    let config: PlatformConfigResponseDto | undefined;
    try {
      config = await this.cache.get<PlatformConfigResponseDto>(
        PLATFORM_CONFIG_CACHE_KEY,
      );
    } catch (error) {
      // Cache errors must never take the platform down.
      // Fail open: allow the request through and log a warning.
      this.logger.warn(
        `Maintenance-mode check failed — failing open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return next();
    }

    if (config?.maintenanceMode) {
      const legacyConfig = config as
        | (PlatformConfigResponseDto & { announcement?: string | null })
        | undefined;
      const maintenanceMessage =
        config.maintenanceMessage ??
        legacyConfig?.announcement ??
        'The platform is currently under maintenance.';

      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message: maintenanceMessage,
        maintenanceMode: true,
      });
    }

    return next();
  }
}
