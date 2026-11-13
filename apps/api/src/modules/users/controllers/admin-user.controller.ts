import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { OtpRequired } from '@api/common/decorators/otp-required.decorator';
import { Roles } from '@api/common/decorators/role.decorator';

import { ApiResponseDto } from '@api/common/dto/api-response.dto';
import {
  extractIpAddress,
  extractUserAgent,
} from '@api/common/utils/request.util';
import { AdminSuspendDto } from '@api/modules/users/dto/admin-suspend.dto';
import { QueryUserDto } from '@api/modules/users/dto/query-user.dto';
import { SuspendUserResponseDto } from '@api/modules/users/dto/suspend-user-response.dto';
import { UserListItemResponseDto } from '@api/modules/users/dto/user-list-item-response.dto';
import { UserResponseDto } from '@api/modules/users/dto/user-response.dto';
import { UsersService } from '@api/modules/users/users.service';
import { OtpService } from '@api/modules/auth/otp/otp.service';

@Roles(ROLE.ADMIN)
@ApiTags('ADMIN - USERS')
@ApiBearerAuth('JWT-auth')
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
  ) {}

  // REQUEST OTP FOR ADMIN ACTIONS
  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @Message('Security verification code sent to your admin email')
  @ApiOperation({
    summary: 'Request OTP for admin user actions',
    description:
      'Sends a 2FA OTP code to the logged-in administrator email for critical actions (suspend/unsuspend/delete).',
  })
  @ApiResponse({
    status: 200,
    description: 'Security verification code sent to your admin email.',
  })
  async requestOtp(
    @GetUser('email') adminEmail: string,
  ): Promise<{ message: string }> {
    if (!adminEmail) {
      throw new UnauthorizedException('Admin email not found in session token');
    }
    await this.otpService.createOtp(adminEmail, 'admin:action');
    return { message: 'Security verification code sent to your admin email' };
  }

  // GET ALL USERS
  @Get()
  @Message('Users retrieved successfully')
  @ApiOperation({
    summary: 'List users with pagination (admin)',
    description: 'Retrieve a paginated list of all users.',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<UserListItemResponseDto[]>,
    description: 'Paginated list of users',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” user does not have ADMIN role.',
  })
  async findAll(@Query() query: QueryUserDto) {
    return this.usersService.findAll(query);
  }

  @Post('query')
  @HttpCode(HttpStatus.OK)
  @Message('Users retrieved successfully')
  @ApiOperation({
    summary: 'List users (filters in body)',
    description: 'Same as GET /admin/users but with filters in the JSON body.',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<UserListItemResponseDto[]>,
    description: 'Paginated list of users',
  })
  async query(@Body() body: QueryUserDto) {
    return this.usersService.findAll(body);
  }

  // GET USER BY ID
  @Get(':id')
  @Message('User retrieved successfully')
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Retrieve a single user by their unique ID.',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, type: ApiResponseDto<UserResponseDto> })
  @ApiNotFoundResponse({ description: 'User not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  // SUSPEND USER (ADMIN)
  @Patch(':id/suspend')
  @OtpRequired('admin:action')
  @Message('User account suspended successfully')
  @ApiOperation({
    summary: 'Suspend user account (admin)',
    description:
      'Suspend a user account with a required administrative reason and optional duration.',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiBody({ type: AdminSuspendDto })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<SuspendUserResponseDto>,
  })
  @ApiBadRequestResponse({
    description: 'Validation error â€” invalid suspension reason or duration.',
  })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async adminSuspend(
    @GetUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: AdminSuspendDto,
    @Req() req: Request,
  ): Promise<SuspendUserResponseDto> {
    return this.usersService.adminSuspend(
      adminId,
      userId,
      dto,
      extractIpAddress(req),
      extractUserAgent(req),
    );
  }

  // UNSUSPEND / RESTORE USER (ADMIN)
  @Patch(':id/unsuspend')
  @OtpRequired('admin:action')
  @HttpCode(HttpStatus.OK)
  @Message('User account unsuspended successfully')
  @ApiOperation({
    summary: 'Unsuspend / restore user account (admin)',
    description: 'Unsuspend a previously suspended user account.',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, type: ApiResponseDto<UserResponseDto> })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async adminUnsuspend(
    @GetUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<UserResponseDto> {
    return this.usersService.adminUnsuspend(
      userId,
      adminId,
      extractIpAddress(req),
      extractUserAgent(req),
    );
  }

  // DELETE USER (ADMIN)
  @Delete(':id')
  @OtpRequired('admin:action')
  @HttpCode(HttpStatus.OK)
  @Message('User account deleted successfully')
  @ApiOperation({
    summary: 'Delete user account (admin)',
    description:
      'Deletes a user account with 2FA OTP verification, immediately revoking active sessions while safely preserving relational and financial ledger integrity.',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” cannot delete an admin account.',
  })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiOkResponse({
    type: ApiResponseDto<null>,
    description: 'User account deleted successfully',
  })
  async deleteUser(
    @GetUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<null> {
    await this.usersService.adminSoftDelete(
      id,
      adminId,
      extractIpAddress(req),
      extractUserAgent(req),
    );
    return null;
  }
}
