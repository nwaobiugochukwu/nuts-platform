import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ROLE } from '@prisma/client';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import type { PlatformConfigResponseDto } from '@api/modules/admin/dto/admin-platform-config.dto';

const PLATFORM_CONFIG_CACHE_KEY = 'platform:config:governance';
const MAINTENANCE_BYPASS_PREFIXES: readonly string[] = [
  '/api/v1/admin/auth',
  '/api/v1/auth/admin',
  '/api/v1/health',
];

interface AuthenticatedRequest extends Request {
  user?: { role?: ROLE };
}

function isBypassed(req: Request): boolean {
  if (req.method === 'OPTIONS') return true;

  const path = req.path.toLowerCase().replace(/\/+$/, '') || '/';
  return MAINTENANCE_BYPASS_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  private readonly logger = new Logger(MaintenanceModeGuard.name);

  constructor(private readonly cache: CacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Authentication and role guards run first. Any valid administrator can
    // continue using the admin app, including shared APIs such as notifications.
    if (req.user?.role === ROLE.ADMIN || isBypassed(req)) return true;

    let config: PlatformConfigResponseDto | undefined;
    try {
      config = await this.cache.get<PlatformConfigResponseDto>(
        PLATFORM_CONFIG_CACHE_KEY,
      );
    } catch (error) {
      // Keep the maintenance control from becoming a platform-wide outage if
      // Redis is unavailable; the cache service itself also fails open.
      this.logger.warn(
        `Maintenance-mode check failed — failing open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }

    if (!config?.maintenanceMode) return true;

    const legacyConfig = config as PlatformConfigResponseDto & {
      announcement?: string | null;
    };
    throw new ServiceUnavailableException({
      statusCode: 503,
      error: 'Service Unavailable',
      message:
        config.maintenanceMessage ??
        legacyConfig.announcement ??
        'The platform is currently under maintenance.',
      maintenanceMode: true,
    });
  }
}
