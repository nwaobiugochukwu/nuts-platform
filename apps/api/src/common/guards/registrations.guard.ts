import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import type { PlatformConfigResponseDto } from '@api/modules/admin/dto/admin-platform-config.dto';

/** Cache key must match the constant in AdminService. */
const PLATFORM_CONFIG_CACHE_KEY = 'platform:config:governance';

/**
 * Discriminator stored in route metadata by the @RegistrationType() decorator.
 *
 * - `'user'`   → checked against `allowRegistrations`
 * - `'vendor'` → checked against `allowVendorRegistrations`
 */
export const REGISTRATION_TYPE_KEY = 'registrationType';

/** The possible registration gate values. */
export type RegistrationKind = 'user' | 'vendor';

/**
 * Guard that blocks customer or vendor registration endpoints when
 * the corresponding platform-config flag is disabled.
 *
 * Usage:
 *   @UseGuards(RegistrationsGuard)
 *   @RegistrationType('user')           ← customer registration endpoint
 *   async register(…) { … }
 *
 *   @UseGuards(RegistrationsGuard)
 *   @RegistrationType('vendor')         ← vendor registration endpoint
 *   async register(…) { … }
 *
 * The guard intentionally fails open if Redis is unavailable — a cache
 * outage must not lock all new users out of the platform permanently.
 */
@Injectable()
export class RegistrationsGuard implements CanActivate {
  private readonly logger = new Logger(RegistrationsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.getAllAndOverride<RegistrationKind | undefined>(
      REGISTRATION_TYPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no @RegistrationType() decorator is present, skip the guard.
    if (!kind) return true;

    let config: PlatformConfigResponseDto | undefined;
    try {
      config = await this.cache.get<PlatformConfigResponseDto>(
        PLATFORM_CONFIG_CACHE_KEY,
      );
    } catch (error) {
      // Fail open on cache errors — a Redis outage must not block sign-ups.
      this.logger.warn(
        `RegistrationsGuard cache read failed — failing open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }

    // No config stored yet → use safe defaults (registrations open).
    if (!config) return true;

    const allowed =
      kind === 'vendor'
        ? config.allowVendorRegistrations
        : config.allowRegistrations;

    if (!allowed) {
      const label =
        kind === 'vendor' ? 'Vendor registrations' : 'Registrations';
      throw new ServiceUnavailableException(
        `${label} are currently disabled by the platform administrator.`,
      );
    }

    return true;
  }
}
