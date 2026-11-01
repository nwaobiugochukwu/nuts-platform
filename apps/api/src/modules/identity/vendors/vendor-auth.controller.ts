import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ROLE } from '@prisma/client';
import { AuthCookieService } from '@api/modules/auth/cookies/auth-cookie.service';
import { RequestOtpDto } from '@api/modules/auth/dto/request-otp.dto';
import { OtpService } from '@api/modules/auth/otp/otp.service';
import type { RefreshJwtPayload } from '@api/modules/auth/types/refresh-jwt-payload.type';
import { AccountLockGuard } from '@api/modules/security/guards/account-lock.guard';
import {
  RefreshTokenThrottle,
  StrictThrottle,
} from '@api/modules/shared/decorators/custom-throttler.decorator';
import { GetUser } from '@api/modules/shared/decorators/get-user.decorator';
import { GetVendor } from '@api/modules/shared/decorators/get-vendor.decorator';
import { JwtRefreshGuard } from '@api/modules/auth/guards/jwt-refresh.guard';
import { Message } from '@api/modules/shared/decorators/message.decorator';
import { Public } from '@api/modules/shared/decorators/public.decorator';
import { Roles } from '@api/modules/shared/decorators/role.decorator';
import { ApiResponseDto } from '@api/modules/shared/dto/api-response.dto';
import {
  extractIpAddress,
  extractUserAgent,
} from '@api/modules/shared/utils/request.util';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { VendorLoginDto } from './dto/update-vendor.dto';
import { VendorResetPasswordDto } from './dto/vendor-reset-password.dto';
import { VendorResponseDto } from './dto/vendor-response.dto';
import { VendorsService } from './vendors.service';

@ApiTags('VENDORS - AUTH')
@Controller('vendors/auth')
export class VendorAuthController {
  constructor(
    private readonly vendorsService: VendorsService,
    private readonly otpService: OtpService,
    private readonly authCookies: AuthCookieService,
  ) {}

  // ---------------------------------------------------------------------------
  // OTP REQUEST
  // ---------------------------------------------------------------------------

  @Public()
  @StrictThrottle()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Message('Verification code sent to your email')
  @ApiOperation({
    summary: 'Request OTP for vendor registration',
    description:
      'Sends a 6-digit verification code to the provided email address to verify ownership before vendor registration.',
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiOkResponse({
    description: 'Verification code sent successfully.',
    type: ApiResponseDto<null>,
  })
  async requestOtp(@Body() dto: RequestOtpDto): Promise<null> {
    await this.otpService.createOtp(dto.email, 'vendor:registration');
    return null;
  }

  // ---------------------------------------------------------------------------
  // REGISTRATION
  // ---------------------------------------------------------------------------

  @Public()
  @StrictThrottle()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Message('Vendor registered successfully')
  @ApiOperation({
    summary: 'Register a new vendor account',
    description:
      'Creates a vendor account with an attached vendor wallet, verifies OTP, and sets session cookies.',
  })
  @ApiBody({ type: CreateVendorDto })
  @ApiCreatedResponse({
    description: 'Vendor registered successfully.',
    type: ApiResponseDto<{ vendor: VendorResponseDto }>,
  })
  @ApiBadRequestResponse({
    description: 'Validation error or invalid OTP',
  })
  @ApiConflictResponse({
    description: 'Email or store slug already in use',
  })
  async register(
    @Body() dto: CreateVendorDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    vendor: VendorResponseDto;
    accessToken?: string;
    tokenType?: string;
    expiresIn?: number;
  }> {
    const session = await this.vendorsService.register(
      dto,
      extractIpAddress(req),
      extractUserAgent(req),
    );

    // Unapproved vendors do not receive session tokens
    if (session.tokens) {
      this.authCookies.setAuthCookies(res, session.tokens);
    }

    return {
      vendor: session.profile,
      accessToken: session.tokens?.accessToken,
      tokenType: session.tokens?.tokenType,
      expiresIn: session.tokens?.expiresIn,
    };
  }

  // ---------------------------------------------------------------------------
  // LOGIN
  // ---------------------------------------------------------------------------

  @Public()
  @StrictThrottle()
  @UseGuards(AccountLockGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Message('Vendor logged in successfully')
  @ApiOperation({
    summary: 'Vendor login',
    description: 'Authenticates a vendor and sets httpOnly auth cookies.',
  })
  @ApiBody({ type: VendorLoginDto })
  @ApiOkResponse({
    description: 'Login successful.',
    type: ApiResponseDto<{ vendor: VendorResponseDto }>,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials or unapproved account',
  })
  async login(
    @Body() dto: VendorLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    vendor: VendorResponseDto;
    accessToken?: string;
    tokenType?: string;
    expiresIn?: number;
  }> {
    const session = await this.vendorsService.login(
      dto,
      extractIpAddress(req),
      extractUserAgent(req),
    );

    // Login always produces tokens (only register can return null)
    this.authCookies.setAuthCookies(res, session.tokens!);

    return {
      vendor: session.profile,
      accessToken: session.tokens!.accessToken,
      tokenType: session.tokens!.tokenType,
      expiresIn: session.tokens!.expiresIn,
    };
  }

  // ---------------------------------------------------------------------------
  // TOKEN REFRESH
  // ---------------------------------------------------------------------------

  @Public()
  @RefreshTokenThrottle()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Message('Tokens refreshed successfully')
  @ApiOperation({
    summary: 'Refresh vendor access token',
    description: 'Rotates the vendor refresh session and sets fresh cookies.',
  })
  @ApiOkResponse({
    description: 'Tokens refreshed successfully.',
    type: ApiResponseDto<{ vendor: VendorResponseDto }>,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, or revoked refresh token',
  })
  async refresh(
    @GetUser() payload: RefreshJwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    vendor: VendorResponseDto;
    accessToken?: string;
    tokenType?: string;
    expiresIn?: number;
  }> {
    if (payload.role !== ROLE.VENDOR) {
      throw new UnauthorizedException('Invalid token role');
    }

    const session = await this.vendorsService.refresh(
      payload.sub,
      payload.refreshId,
    );

    // Refresh always produces tokens
    this.authCookies.setAuthCookies(res, session.tokens!);

    return {
      vendor: session.profile,
      accessToken: session.tokens!.accessToken,
      tokenType: session.tokens!.tokenType,
      expiresIn: session.tokens!.expiresIn,
    };
  }

  // ---------------------------------------------------------------------------
  // LOGOUT
  // ---------------------------------------------------------------------------

  @Roles(ROLE.VENDOR)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Message('Logged out successfully')
  @ApiOperation({
    summary: 'Log out the current vendor session',
  })
  @ApiOkResponse({
    description: 'Logged out successfully.',
    type: ApiResponseDto<null>,
  })
  async logout(
    @GetVendor('id') vendorId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<null> {
    await this.vendorsService.logout(
      vendorId,
      extractIpAddress(req),
      extractUserAgent(req),
    );

    this.authCookies.clearAuthCookies(res);

    return null;
  }

  // ---------------------------------------------------------------------------
  // FORGOT PASSWORD OTP & RESET
  // ---------------------------------------------------------------------------

  @Public()
  @StrictThrottle()
  @Post('forgot-password/otp/request')
  @HttpCode(HttpStatus.OK)
  @Message('Password reset code sent to your email')
  @ApiOperation({
    summary: 'Request password reset OTP for vendor',
    description: 'Sends a 6-digit password reset code to the vendor email.',
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiOkResponse({
    description: 'Password reset code sent successfully.',
    type: ApiResponseDto<null>,
  })
  async requestForgotPasswordOtp(@Body() dto: RequestOtpDto): Promise<null> {
    await this.otpService.createOtp(dto.email, 'password-reset');
    return null;
  }

  @Public()
  @StrictThrottle()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Message('Password reset successfully')
  @ApiOperation({
    summary: 'Reset vendor password using OTP',
  })
  @ApiBody({ type: VendorResetPasswordDto })
  @ApiOkResponse({
    description: 'Password reset successfully.',
    type: ApiResponseDto<null>,
  })
  @ApiBadRequestResponse({
    description: 'Invalid OTP or password format',
  })
  async resetPassword(
    @Body() dto: VendorResetPasswordDto,
    @Req() req: Request,
  ): Promise<null> {
    await this.vendorsService.resetPassword(
      dto,
      extractIpAddress(req),
      extractUserAgent(req),
    );
    return null;
  }
}
