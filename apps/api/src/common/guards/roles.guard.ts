import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE } from '@prisma/client';
import { IS_PUBLIC_KEY } from '@api/common/decorators/public.decorator';
import { ROLES_KEY } from '@api/common/decorators/role.decorator';

type AuthUser = {
  id: string;
  email: string;
  role: ROLE;
};

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthUser; path?: string; originalUrl?: string }>();
    const path = request.originalUrl || request.path || '';

    // Hard security gate for all admin routes:
    // Any endpoint matching /admin (unless explicitly decorated with @Public() like login/setup) strictly requires ROLE.ADMIN
    const isAdminRoute = /\/api\/v\d+\/admin\b|\/admin\b/i.test(path);
    if (isAdminRoute && !isPublic) {
      const user = request.user;
      if (!user || user.role !== ROLE.ADMIN) {
        this.logger.warn(
          {
            event: 'authorization_denied',
            requiredRole: ROLE.ADMIN,
            actualRole: user?.role ?? 'anonymous',
          },
          'Admin route role check failed',
        );
        throw new ForbiddenException(
          'Access denied: Administrator privileges required.',
        );
      }
    }

    const requiredRoles = this.reflector.getAllAndOverride<ROLE[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const user = request.user;

    if (!user) {
      // Global guards run before route-scoped auth guards, including on public
      // refresh routes. Defer their role check until request.user is available.
      if (isPublic) {
        return true;
      }

      this.logger.warn(
        {
          event: 'authorization_denied',
          requiredRoles,
          actualRole: 'anonymous',
        },
        'Role check failed for unauthenticated request',
      );
      throw new ForbiddenException('Access denied: User is not authenticated.');
    }

    if (!requiredRoles.includes(user.role)) {
      this.logger.warn(
        {
          event: 'authorization_denied',
          requiredRoles,
          actualRole: user.role,
        },
        'Role check failed for authenticated request',
      );
      throw new ForbiddenException(`Access denied`);
    }

    return true;
  }
}
