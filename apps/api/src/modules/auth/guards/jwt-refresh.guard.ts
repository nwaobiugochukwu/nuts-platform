import type { ExecutionContext } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {
  private readonly logger = new Logger(JwtRefreshGuard.name);

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return (await super.canActivate(context)) as boolean;
    } catch (error) {
      const request = context.switchToHttp().getRequest<{ path?: string }>();
      this.logger.warn(
        {
          event: 'refresh_authentication_failed',
          path: request.path,
        },
        'Refresh token authentication rejected',
      );
      throw error;
    }
  }
}
