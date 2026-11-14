import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import { IS_PUBLIC_KEY } from '@api/common/decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '@api/common/decorators/optional-auth.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly defaultGuard = new (AuthGuard('jwt'))();

  constructor(private readonly reflector: Reflector) {}

  private async executeGuard(
    guard: CanActivate,
    context: ExecutionContext,
  ): Promise<boolean> {
    const result = guard.canActivate(context);
    if (isObservable(result)) {
      return firstValueFrom(result);
    }
    return result;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isOptional = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isOptional) {
      try {
        await this.executeGuard(this.defaultGuard, context);
      } catch {
        // Token is absent or expired: proceed as anonymous guest
      }
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    return this.executeGuard(this.defaultGuard, context);
  }
}
