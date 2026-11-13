import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import type { OtpPurpose } from '@api/modules/auth/otp/otp.service';
import { OtpService } from '@api/modules/auth/otp/otp.service';
import { OTP_REQUIRED_KEY } from '@api/common/decorators/otp-required.decorator';
import { JwtUser } from '@api/common/interfaces/jwt-user.interface';

interface AuthenticatedRequest extends Request {
  user?: JwtUser;
  body: { otpCode?: string };
}

@Injectable()
export class OtpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly otpService: OtpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const otpPurpose = this.reflector.getAllAndOverride<OtpPurpose>(
      OTP_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!otpPurpose) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user || !user.email) {
      throw new UnauthorizedException(
        'Authentication required for OTP validation',
      );
    }

    const otpCode =
      (request.headers['x-otp-code'] as string | undefined) ||
      request.body?.otpCode;
    if (!otpCode) {
      throw new BadRequestException(
        'OTP code is required in x-otp-code header or request body',
      );
    }

    await this.otpService.verifyOtp(user.email, otpCode, otpPurpose);
    return true;
  }
}
