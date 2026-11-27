import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AuthService } from '../services/auth.service';
import { AuthCookieService } from '../services/auth-cookie.service';

import {
  AuthApiResponseDto,
  AuthResponseDto,
  VerifyOtpResponseDto,
} from '../dto/auth-response.dto';
import { LoginDto } from '../dto/login.dto';
import { GoogleAuthDto } from '../dto/google-auth.dto';
import { RegisterDto } from '../dto/register.dto';
import { RequestOtpDto } from '../dto/request-otp.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';

import { AccountLockGuard } from '@api/modules/security/guards/account-lock.guard';
import { JwtRefreshGuard } from '../guards/jwt-refresh.guard';

import { Message } from '@api/common/decorators/message.decorator';
import { Public } from '@api/common/decorators/public.decorator';
import { RegistrationsGuard } from '@api/common/guards/registrations.guard';
import { RegistrationType } from '@api/common/decorators/registration-type.decorator';

import {
  PasswordResetThrottle,
  RefreshTokenThrottle,
  StrictThrottle,
} from '@api/common/decorators/custom-throttler.decorator';

import { GetUser } from '@api/common/decorators/get-user.decorator';

import {
  extractIpAddress,
  extractUserAgent,
} from '@api/common/utils/request.util';

import { ApiResponseDto } from '@api/common/dto/api-response.dto';

import type { AuthenticatedUser } from '../types/authenticated-user.types';
import type { RefreshJwtPayload } from '../types/refresh-jwt-payload.types';
import { ROLE } from '@prisma/client';
import { AUTH_REFRESH_COOKIE } from '../constants/auth-cookies.constants';
import { Audit } from '@api/modules/audit/decorators/audit.decorator';

function getCookieValue(cookies: unknown, name: string): string | undefined {
  if (typeof cookies !== 'object' || cookies === null || !(name in cookies)) {
    return undefined;
  }
  const value = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

@ApiTags('AUTH')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookies: AuthCookieService,
  ) {}

  @Get('me')
  @Message('Current session retrieved successfully')
  @ApiOperation({
    summary: 'Get the authenticated identity profile',
  })
  @ApiOkResponse({
    description: 'Current authenticated identity profile.',
  })
  @ApiUnauthorizedResponse({
    description: 'Not authenticated',
  })
  async me(@GetUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user);
  }

  @Public()
  @StrictThrottle()
  @Audit({ action: 'USER_GOOGLE_LOGIN', entity: 'User' })
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Message('Google authentication successful')
  @ApiOperation({
    summary: 'Sign in with Google ID token',
    description:
      'Verifies a Google ID token and signs in an existing customer account. This route never creates a new account; use POST /auth/google/register to sign up.',
  })
  @ApiBody({ type: GoogleAuthDto })
  @ApiOkResponse({
    description: 'Authentication successful.',
    type: AuthApiResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid token or missing email',
  })
  @ApiUnauthorizedResponse({
    description:
      'Invalid Google token, suspended account, or no existing account for this Google identity',
  })
  async googleAuth(
    @Body() dto: GoogleAuthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.authService.googleAuth(
      dto,
      extractIpAddress(req),
      extractUserAgent(req),
      'login',
    );

    this.authCookies.setAuthCookies(res, session.tokens);

    return {
      user: session.user,
      accessToken: session.tokens.accessToken,
      tokenType: session.tokens.tokenType,
      expiresIn: session.tokens.expiresIn,
    };
  }

  @Public()
  @StrictThrottle()
  @UseGuards(RegistrationsGuard)
  @RegistrationType('user')
  @Audit({ action: 'USER_GOOGLE_LOGIN', entity: 'User' })
  @Post('google/register')
  @HttpCode(HttpStatus.OK)
  @Message('Google registration successful')
  @ApiOperation({
    summary: 'Sign up with a Google ID token',
    description:
      'Verifies a Google ID token and creates a customer account only when no account exists. If an account already exists, sign in through POST /auth/google.',
  })
  @ApiBody({ type: GoogleAuthDto })
  @ApiOkResponse({
    description: 'Google registration successful.',
    type: AuthApiResponseDto,
  })
  @ApiConflictResponse({
    description: 'A customer account already exists; sign in instead.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid token or missing email',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid Google token or account suspended',
  })
  async googleRegister(
    @Body() dto: GoogleAuthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.authService.googleAuth(
      dto,
      extractIpAddress(req),
      extractUserAgent(req),
      'signup',
    );

    this.authCookies.setAuthCookies(res, session.tokens);

    return {
      user: session.user,
      accessToken: session.tokens.accessToken,
      tokenType: session.tokens.tokenType,
      expiresIn: session.tokens.expiresIn,
    };
  }

  @Public()
  @StrictThrottle()
  @UseGuards(RegistrationsGuard)
  @RegistrationType('user')
  @Audit({ action: 'USER_REGISTER', entity: 'User' })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Message('User registered successfully')
  @ApiOperation({
    summary: 'Register a new user account',
  })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'User registered successfully.',
    type: AuthApiResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation error or invalid OTP',
  })
  @ApiConflictResponse({
    description: 'An account with this email already exists',
  })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.authService.register(dto);

    this.authCookies.setAuthCookies(res, session.tokens);

    return {
      user: session.user,
      accessToken: session.tokens.accessToken,
      tokenType: session.tokens.tokenType,
      expiresIn: session.tokens.expiresIn,
    };
  }

  @Public()
  @StrictThrottle()
  @UseGuards(AccountLockGuard)
  @Audit({
    action: 'USER_LOGIN',
    failureAction: 'USER_LOGIN_FAILED',
    onFailure: true,
    entity: 'User',
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Message('Logged in successfully')
  @ApiOperation({
    summary: 'Log in with email and password',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Login successful.',
    type: AuthApiResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.authService.login(dto);

    this.authCookies.setAuthCookies(res, session.tokens);

    return {
      user: session.user,
      accessToken: session.tokens.accessToken,
      tokenType: session.tokens.tokenType,
      expiresIn: session.tokens.expiresIn,
    };
  }

  @Public()
  @RefreshTokenThrottle()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Message('Tokens refreshed successfully')
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Rotates the refresh session and issues a new access token.',
  })
  @ApiOkResponse({
    description: 'Tokens refreshed successfully.',
    type: ApiResponseDto<AuthResponseDto>,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, or rotated refresh token',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many refresh attempts.',
  })
  async refresh(
    @GetUser() payload: RefreshJwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    /**
     * Passing the refreshId is essential.
     *
     * AuthService uses it as a compare-and-swap value so two
     * simultaneous refresh requests cannot both rotate the same session.
     */
    if (payload.role !== ROLE.USER) {
      // Vendor and admin refresh tokens are consumed only by their own endpoints.
      throw new UnauthorizedException('Invalid token role');
    }

    const session = await this.authService.refresh(payload);

    this.authCookies.setAuthCookies(res, session.tokens);

    return {
      user: session.user,
      accessToken: session.tokens.accessToken,
      tokenType: session.tokens.tokenType,
      expiresIn: session.tokens.expiresIn,
    };
  }

  @Audit({ action: 'USER_LOGOUT', entity: 'User' })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Message('Logged out successfully')
  @ApiOperation({
    summary: 'Log out the current user session',
  })
  @ApiOkResponse({
    description: 'Logged out successfully.',
    type: ApiResponseDto<null>,
  })
  @ApiUnauthorizedResponse({
    description: 'Not authenticated',
  })
  async logout(
    @GetUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<null> {
    const refreshToken =
      getCookieValue(req.cookies as unknown, AUTH_REFRESH_COOKIE) ??
      getCookieValue(req.cookies as unknown, 'refresh_token');

    await this.authService.logout(
      user.id,
      user.role,
      user.sessionId,
      refreshToken,
    );

    this.authCookies.clearAuthCookies(res);

    return null;
  }

  @Audit({ action: 'USER_LOGOUT_ALL', entity: 'User' })
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @Message('All sessions logged out successfully')
  @ApiOperation({
    summary: 'Log out from all devices and invalidate all active sessions',
  })
  @ApiOkResponse({
    description: 'All sessions logged out successfully.',
    type: ApiResponseDto<null>,
  })
  @ApiUnauthorizedResponse({
    description: 'Not authenticated',
  })
  async logoutAll(
    @GetUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<null> {
    await this.authService.logoutAll(user.id);

    this.authCookies.clearAuthCookies(res);

    return null;
  }

  // ---------------------------------------------------------------------------
  // OTP & PASSWORD RESET
  // ---------------------------------------------------------------------------

  @Public()
  @StrictThrottle()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Message('Verification code sent to your email')
  @ApiOperation({
    summary: 'Request OTP for registration',
    description:
      'Sends a 6-digit verification code to the provided email address to verify ownership before registration.',
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiOkResponse({
    description: 'Verification code sent successfully.',
    type: ApiResponseDto<null>,
  })
  @ApiBadRequestResponse({
    description: 'Invalid email address or rate limit exceeded',
  })
  @ApiConflictResponse({
    description: 'An account with this email already exists',
  })
  async requestRegistrationOtp(@Body() dto: RequestOtpDto): Promise<null> {
    await this.authService.requestRegistrationOtp(dto);
    return null;
  }

  @Public()
  @StrictThrottle()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Message('Verification code confirmed successfully')
  @ApiOperation({
    summary: 'Verify registration OTP code',
    description:
      'Validates the 6-digit OTP code before proceeding to shipping address setup and account completion.',
  })
  @ApiBody({ type: VerifyOtpDto })
  @ApiOkResponse({
    description: 'Verification code confirmed successfully.',
    type: ApiResponseDto<VerifyOtpResponseDto>,
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired OTP code',
  })
  async verifyRegistrationOtp(
    @Body() dto: VerifyOtpDto,
  ): Promise<VerifyOtpResponseDto> {
    return this.authService.verifyRegistrationOtp(dto);
  }

  @Public()
  @PasswordResetThrottle()
  @Post('forgot-password/otp/request')
  @HttpCode(HttpStatus.OK)
  @Message(
    'If an account exists with this email, a verification code has been sent.',
  )
  @ApiOperation({
    summary: 'Request OTP for forgot password / password reset',
    description:
      'Sends a 6-digit verification code to the provided email address if an active account exists.',
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiOkResponse({
    description: 'Password reset code sent.',
    type: ApiResponseDto<null>,
  })
  @ApiBadRequestResponse({
    description: 'Invalid email address or rate limit exceeded',
  })
  async requestPasswordResetOtp(@Body() dto: RequestOtpDto): Promise<null> {
    await this.authService.requestPasswordResetOtp(dto);
    return null;
  }

  @Public()
  @PasswordResetThrottle()
  @Audit({ action: 'USER_RESET_PASSWORD', entity: 'User' })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Message('Password reset successfully')
  @ApiOperation({
    summary: 'Reset password using OTP',
    description:
      'Verifies the 6-digit OTP code and updates the account password.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({
    description: 'Password reset successfully.',
    type: ApiResponseDto<null>,
  })
  @ApiBadRequestResponse({
    description: 'Validation error or invalid OTP code',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired OTP code',
  })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<null> {
    await this.authService.resetPassword(dto);
    return null;
  }
}
