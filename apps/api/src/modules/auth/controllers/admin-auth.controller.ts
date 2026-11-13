import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuthCookieService } from '@api/modules/auth/cookies/auth-cookie.service';
import { LoginDto } from '@api/modules/auth/dto/login.dto';
import { JwtRefreshGuard } from '@api/modules/auth/guards/jwt-refresh.guard';
import type { RefreshJwtPayload } from '@api/modules/auth/types/refresh-jwt-payload.type';
import { AccountLockGuard } from '@api/modules/security/guards/account-lock.guard';
import {
  RefreshTokenThrottle,
  StrictThrottle,
} from '@api/common/decorators/custom-throttler.decorator';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Public } from '@api/common/decorators/public.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';
import {
  extractIpAddress,
  extractUserAgent,
} from '@api/common/utils/request.util';
import { AdminAuthService } from '../admin-auth.service';
import { AdminAuthResponseDto } from '../dto/admin-auth-response.dto';
import { AdminAuthUserDto } from '../dto/admin-auth-user.dto';
import { AdminRegisterDto } from '../dto/admin-register.dto';
import { UpdateAdminProfileDto } from '../dto/update-admin-profile.dto';

@ApiTags('ADMIN - AUTH')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly authCookies: AuthCookieService,
  ) {}

  @Public()
  @StrictThrottle()
  @UseGuards(AccountLockGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Message('Admin logged in successfully')
  @ApiOperation({
    summary: 'Admin login',
    description:
      'Authenticates an admin user and sets httpOnly auth cookies ' +
      '(access + refresh). Only accounts with the ADMIN role are permitted. ' +
      'Non-admin users receive a 403 Forbidden response.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    type: ApiResponseDto<AdminAuthResponseDto>,
    description:
      'Login successful. Access and refresh tokens set as httpOnly cookies.',
  })
  @ApiBadRequestResponse({
    description: 'Validation error â€” invalid email or password format.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials â€” email or password is wrong.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” the user does not have the ADMIN role.',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponseDto> {
    const session = await this.adminAuthService.login(
      dto,
      extractIpAddress(req),
      extractUserAgent(req),
    );

    this.authCookies.setAuthCookies(res, session.tokens);

    return {
      admin: session.user,
      accessToken: session.tokens.accessToken,
      tokenType: session.tokens.tokenType,
      expiresIn: session.tokens.expiresIn,
    };
  }

  @Public()
  @StrictThrottle()
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  @Message('Initial admin account created successfully')
  @ApiOperation({
    summary: 'Bootstrap the first admin account (one-time)',
    description:
      'Creates the initial admin account. This endpoint is only available ' +
      'when no admin exists in the database. Requires the ADMIN_SETUP_SECRET ' +
      'environment variable to be configured. After the first admin is ' +
      'created, this endpoint returns 409 Conflict.',
  })
  @ApiBody({ type: AdminRegisterDto })
  @ApiCreatedResponse({
    type: ApiResponseDto<AdminAuthResponseDto>,
    description:
      'Initial admin created. Auth cookies set with the new session.',
  })
  @ApiBadRequestResponse({
    description:
      'Validation error, or admin setup is not configured (ADMIN_SETUP_SECRET missing).',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid setup secret â€” the provided secret does not match.',
  })
  @ApiConflictResponse({
    description: 'Conflict â€” an admin account already exists.',
  })
  async setup(
    @Body() dto: AdminRegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponseDto> {
    const session = await this.adminAuthService.setup(
      dto,
      extractIpAddress(req),
      extractUserAgent(req),
    );

    this.authCookies.setAuthCookies(res, session.tokens);

    return {
      admin: session.user,
      accessToken: session.tokens.accessToken,
      tokenType: session.tokens.tokenType,
      expiresIn: session.tokens.expiresIn,
    };
  }

  @Public()
  @RefreshTokenThrottle()
  @UseGuards(JwtRefreshGuard)
  @Roles(ROLE.ADMIN)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Message('Tokens refreshed successfully')
  @ApiOperation({
    summary: 'Rotate admin access and refresh tokens',
    description:
      'Uses the httpOnly refreshToken cookie to issue a new access + ' +
      'refresh token pair. The previous refresh token is invalidated ' +
      '(rotation). Requires a valid refresh token and the ADMIN role.',
  })
  @ApiOkResponse({
    type: ApiResponseDto<AdminAuthResponseDto>,
    description: 'Tokens refreshed. New auth cookies set.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired refresh token.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” the user does not have the ADMIN role.',
  })
  async refresh(
    @GetUser() payload: RefreshJwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponseDto> {
    const session = await this.adminAuthService.refresh(
      payload.sub,
      payload.refreshId,
    );

    this.authCookies.setAuthCookies(res, session.tokens);

    return {
      admin: session.user,
      accessToken: session.tokens.accessToken,
      tokenType: session.tokens.tokenType,
      expiresIn: session.tokens.expiresIn,
    };
  }

  @Roles(ROLE.ADMIN)
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @Message('Current admin session retrieved successfully')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get the current authenticated admin',
    description:
      'Returns the profile of the admin attached to the current session. ' +
      'Used by the admin dashboard to rehydrate the session after a page ' +
      'refresh. Requires a valid JWT session with the ADMIN role.',
  })
  @ApiOkResponse({
    description: 'Current admin session identity.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” the user does not have the ADMIN role.',
  })
  async me(@GetUser('id') adminId: string): Promise<AdminAuthUserDto> {
    // NOTE: returns the bare user object (same shape as GET /auth/me) â€”
    // the client's apiGet() unwraps the response envelope and expects the
    // user fields directly at the top level.
    return this.adminAuthService.me(adminId);
  }

  @Roles(ROLE.ADMIN)
  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @Message('Admin profile updated successfully')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Update current admin profile',
    description:
      'Updates profile information such as first and last name for the authenticated admin.',
  })
  @ApiBody({ type: UpdateAdminProfileDto })
  @ApiOkResponse({
    description: 'Updated admin session identity.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” the user does not have the ADMIN role.',
  })
  async updateMe(
    @GetUser('id') adminId: string,
    @Body() dto: UpdateAdminProfileDto,
  ): Promise<AdminAuthUserDto> {
    return this.adminAuthService.updateProfile(adminId, dto);
  }

  @Roles(ROLE.ADMIN)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Message('Admin logged out successfully')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Log out and invalidate the admin session',
    description:
      'Invalidates the current admin session and clears the httpOnly ' +
      'access and refresh cookies. Requires an active JWT session with ' +
      'the ADMIN role.',
  })
  @ApiOkResponse({
    description: 'Logged out successfully. Auth cookies cleared.',
    type: ApiResponseDto<null>,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” the user does not have the ADMIN role.',
  })
  async logout(
    @GetUser('id') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<null> {
    await this.adminAuthService.logout(
      userId,
      extractIpAddress(req),
      extractUserAgent(req),
    );
    this.authCookies.clearAuthCookies(res);
    return null;
  }
}
