import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ROLE } from '@prisma/client';
import { Roles } from '@api/common/decorators/role.decorator';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import {
  extractIpAddress,
  extractUserAgent,
} from '@api/common/utils/request.util';
import { AdminService } from '../admin.service';
import {
  PlatformConfigResponseDto,
  UpdatePlatformConfigDto,
} from '../dto/admin-platform-config.dto';

@ApiTags('ADMIN - PLATFORM GOVERNANCE')
@ApiBearerAuth()
@Roles(ROLE.ADMIN)
@Controller('admin/platform')
export class AdminPlatformController {
  constructor(private readonly adminService: AdminService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Get platform-wide configuration and feature toggles',
  })
  @Message('Platform configuration retrieved successfully')
  async getPlatformConfig(): Promise<PlatformConfigResponseDto> {
    return this.adminService.getPlatformConfig();
  }

  @Patch('config')
  @ApiOperation({
    summary: 'Update platform configuration (maintenance mode, toggles)',
  })
  @Message('Platform configuration updated successfully')
  async updatePlatformConfig(
    @Body() dto: UpdatePlatformConfigDto,
    @GetUser('id') adminId: string,
    @Req() req: Request,
  ): Promise<PlatformConfigResponseDto> {
    return this.adminService.updatePlatformConfig(
      dto,
      adminId,
      extractIpAddress(req),
      extractUserAgent(req),
    );
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get high-level platform system metric counts' })
  @Message('System overview retrieved successfully')
  async getSystemOverview() {
    return this.adminService.getSystemOverview();
  }
}
