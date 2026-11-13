import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountLockService } from '../services/account-lock.service';

/**
 * Guard to check if an account is locked before processing login requests.
 * Should be applied to login routes.
 */
@Injectable()
export class AccountLockGuard implements CanActivate {
  private readonly logger = new Logger(AccountLockGuard.name);

  constructor(private readonly accountLockService: AccountLockService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const email = (request.body as { email?: string } | undefined)?.email;

    if (!email) {
      return true; // Let validation handle missing email
    }

    const identifier = `email:${email.toLowerCase().trim()}`;
    const isLocked = await this.accountLockService.isLocked(identifier);

    if (isLocked) {
      const remaining =
        await this.accountLockService.getLockoutTimeRemaining(identifier);
      this.logger.warn('Blocked login for locked account');
      throw new UnauthorizedException(
        `Account temporarily locked. Try again in ${Math.ceil(remaining / 60)} minutes.`,
      );
    }

    return true;
  }
}
