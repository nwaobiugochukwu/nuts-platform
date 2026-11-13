// users.controller.ts

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ROLE } from '@prisma/client';
import { AuthCookieService } from '@api/modules/auth/cookies/auth-cookie.service';
import { OtpService } from '@api/modules/auth/otp/otp.service';
import { ReferralService } from '@api/modules/referral/referral.service';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { OtpRequired } from '@api/common/decorators/otp-required.decorator';
import { Public } from '@api/common/decorators/public.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';
import {
  extractIpAddress,
  extractUserAgent,
} from '@api/common/utils/request.util';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { DeactivateAccountResponseDto } from '../dto/deactivate-account-response.dto';
import { ReactivateAccountDto } from '../dto/reactivate-account.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { UsersService } from '../users.service';

@ApiTags('USERS')
@Controller('account')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authCookies: AuthCookieService,
    private readonly otpService: OtpService,
    private readonly referralService: ReferralService,
  ) {}

  /**
   * Returns the currently authenticated user's profile.
   *
   * GetUser is preferable to reading req.user manually because it keeps
   * authentication-specific request handling out of the controller.
   */
  @Get()
  @Roles(ROLE.USER)
  @ApiBearerAuth('JWT-auth')
  @Message('Profile retrieved successfully')
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Retrieve the authenticated user profile.',
  })
  @ApiOkResponse({
    description: 'Profile retrieved successfully.',
    type: ApiResponseDto<UserResponseDto>,
  })
  @ApiNotFoundResponse({
    description: 'User account not found or has been deactivated',
  })
  @ApiUnauthorizedResponse({
    description: 'Not authenticated',
  })
  async getProfile(@GetUser('id') userId: string): Promise<UserResponseDto> {
    return this.usersService.findOne(userId);
  }

  /**
   * Updates the authenticated user's profile.
   *
   * IP address and user-agent are passed to the service for audit logging.
   */
  @Patch()
  @Roles(ROLE.USER)
  @ApiBearerAuth('JWT-auth')
  @Message('Profile updated successfully')
  @ApiBody({ type: UpdateUserDto })
  @ApiOperation({
    summary: 'Update current user profile and saved shipping information',
    description:
      'Use this endpoint to update profile fields, update primary phone, create a new saved shipping address, or set an existing saved shipping address as the default.',
  })
  @ApiOkResponse({
    description: 'Profile updated successfully.',
    type: ApiResponseDto<UserResponseDto>,
  })
  @ApiNotFoundResponse({
    description: 'User account not found or has been deactivated',
  })
  @ApiConflictResponse({
    description: 'Email address is already in use by another account',
  })
  @ApiUnauthorizedResponse({
    description: 'Not authenticated',
  })
  async updateProfile(
    @GetUser('id') userId: string,
    @Body() updateUserDto: UpdateUserDto,
    @Req() req: Request,
  ): Promise<UserResponseDto> {
    return this.usersService.update(
      userId,
      updateUserDto,
      extractIpAddress(req),
      extractUserAgent(req),
    );
  }

  /**
   * Changes the authenticated user's password.
   *
   * The service is responsible for verifying the current password,
   * hashing the replacement password, and invalidating refresh sessions.
   */
  @Patch('password')
  @Roles(ROLE.USER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @Message('Password changed successfully')
  @ApiOperation({
    summary: 'Change current user password',
    description:
      'Changes the authenticated user password. Requires current password for verification.',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiOkResponse({
    description: 'Password changed successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Current password is incorrect',
  })
  @ApiNotFoundResponse({
    description: 'User account not found or has been deactivated',
  })
  @ApiUnauthorizedResponse({
    description: 'Not authenticated',
  })
  async changePassword(
    @GetUser('id') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<null> {
    await this.usersService.changePassword(
      userId,
      changePasswordDto,
      extractIpAddress(req),
      extractUserAgent(req),
    );

    return null;
  }

  /**
   * Generates and dispatches a 6-digit OTP to the user's email address for sensitive
   * account operations such as deactivation.
   */
  @Post('otp/request')
  @Roles(ROLE.USER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @Message('Verification code sent to your email')
  @ApiOperation({
    summary: 'Request OTP for account actions',
    description:
      'Sends an OTP to the authenticated user email for actions requiring 2FA.',
  })
  @ApiOkResponse({
    description: 'Verification OTP sent successfully.',
  })
  async requestAccountOtp(
    @GetUser('id') userId: string,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findOne(userId);
    await this.otpService.createOtp(user.email, 'account-deactivation');
    return { message: 'Verification code sent to your email' };
  }

  /**
   * Deactivates the account and clears authentication cookies immediately.
   *
   * Clearing cookies is intentionally handled at the controller boundary
   * because cookies are an HTTP concern, not a service/database concern.
   */
  @Patch('deactivate')
  @Roles(ROLE.USER)
  @OtpRequired('account-deactivation')
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @Message('Account deactivated successfully')
  @ApiOperation({
    summary: 'Deactivate account',
    description:
      'Requires OTP verification. Disables the account and schedules permanent deletion after a grace period (default 60 days, configurable). Clears auth cookies.',
  })
  @ApiOkResponse({
    description: 'Account deactivated successfully. Auth cookies cleared.',
    type: ApiResponseDto<DeactivateAccountResponseDto>,
  })
  @ApiNotFoundResponse({
    description: 'User account not found or has been deactivated',
  })
  @ApiUnauthorizedResponse({
    description: 'Not authenticated',
  })
  async deactivateAccount(
    @GetUser('id') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeactivateAccountResponseDto> {
    const result = await this.usersService.deactivate(
      userId,
      extractIpAddress(req),
      extractUserAgent(req),
    );

    this.authCookies.clearAuthCookies(res);

    return result;
  }

  /**
   * Reactivation intentionally remains public because a deactivated user
   * cannot authenticate through the normal protected routes.
   */
  @Public()
  @Post('reactivate')
  @HttpCode(HttpStatus.OK)
  @Message('Account reactivated successfully')
  @ApiOperation({
    summary: 'Reactivate a deactivated account',
    description:
      'Restores account if still within the grace period (default 60 days). Then sign in via /auth/login.',
  })
  @ApiBody({ type: ReactivateAccountDto })
  @ApiOkResponse({
    description: 'Account reactivated successfully.',
    type: ApiResponseDto<UserResponseDto>,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid email/password or account grace period has expired (account permanently deleted)',
  })
  async reactivate(
    @Body() dto: ReactivateAccountDto,
    @Req() req: Request,
  ): Promise<UserResponseDto> {
    return this.usersService.reactivate(
      dto.email,
      dto.password,
      extractIpAddress(req),
      extractUserAgent(req),
    );
  }

  /**
   * Permanently deletes the authenticated account.
   *
   * Auth cookies are cleared after successful deletion so a browser does not
   * retain stale authentication state.
   */
  @Delete('delete')
  @Roles(ROLE.USER)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @Message('Account permanently deleted successfully')
  @ApiOperation({
    summary: 'Permanently delete account',
    description:
      'Irreversibly deletes the account. Admin accounts cannot be deleted.',
  })
  @ApiOkResponse({
    description: 'Account permanently deleted',
    type: ApiResponseDto<null>,
  })
  @ApiNotFoundResponse({
    description: 'User account not found or has been deactivated',
  })
  @ApiConflictResponse({
    description: 'Admin accounts cannot be deleted. Contact support.',
  })
  @ApiUnauthorizedResponse({
    description: 'Not authenticated',
  })
  async permanentDelete(
    @GetUser('id') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<null> {
    await this.usersService.permanentDelete(
      userId,
      extractIpAddress(req),
      extractUserAgent(req),
    );

    // Prevent the browser from retaining authentication cookies
    // after the underlying account has been permanently removed.
    this.authCookies.clearAuthCookies(res);

    return null;
  }

  // ---------------------------------------------------------------------------
  // REFERRAL
  // ---------------------------------------------------------------------------

  /**
   * Public endpoint so the registration form can validate a referral code
   * before submitting the full registration payload.
   *
   * We intentionally do NOT return the referrer's identity â€” just
   * a validity flag so the UI can give immediate feedback.
   */
  @Public()
  @Get('referral/validate')
  @Post('referral/validate')
  @HttpCode(HttpStatus.OK)
  @Message('Referral code validated')
  @ApiOperation({
    summary: 'Validate a referral code',
    description:
      'Check whether a given referral code exists and is valid. ' +
      'Returns {valid: true} if the code can be applied at registration.',
  })
  @ApiOkResponse({ description: 'Referral code is valid.' })
  @ApiBadRequestResponse({ description: 'Invalid referral code.' })
  async validateReferralCode(
    @Query('code') queryCode?: string,
    @Query('email') queryEmail?: string,
    @Body() body?: { code?: string; email?: string },
  ): Promise<{ valid: boolean; message: string }> {
    const rawCode = queryCode || body?.code;
    const email = queryEmail || body?.email;
    if (!rawCode || !rawCode.trim()) {
      return { valid: false, message: 'Referral code is required' };
    }
    await this.referralService.validateReferralCode(
      rawCode.trim(),
      email ?? '__pre_validation__@nuts.placeholder',
    );
    return { valid: true, message: 'Referral code is valid' };
  }

  /**
   * Returns the authenticated user's referral programme stats:
   * - Their own referral code
   * - Total people they have referred
   * - Whether any of those referrals have been rewarded
   * - Total wallet credits earned via referrals
   */
  @Get('referral/stats')
  @Roles(ROLE.USER)
  @ApiBearerAuth('JWT-auth')
  @Message('Referral stats retrieved successfully')
  @ApiOperation({
    summary: 'Get current user referral programme stats',
  })
  @ApiOkResponse({ description: 'Referral stats retrieved.' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async getReferralStats(@GetUser('id') userId: string): Promise<{
    code: string | null;
    totalReferred: number;
    rewardedCount: number;
    pendingCount: number;
  }> {
    return this.usersService.getReferralStats(userId);
  }
}
