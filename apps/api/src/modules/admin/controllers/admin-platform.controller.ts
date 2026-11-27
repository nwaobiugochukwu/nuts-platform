import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {} from 'express';
import { ROLE } from '@prisma/client';
import { Roles } from '@api/common/decorators/role.decorator';
import {} from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import {} from '@api/common/utils/request.util';
import { AdminService } from '../admin.service';
import {
  PlatformConfigResponseDto,
  UpdatePlatformConfigDto,
} from '../dto/admin-platform-config.dto';
import { Audit } from '@api/modules/audit/decorators/audit.decorator';

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

  @Audit({ action: 'PLATFORM_CONFIG_UPDATED', entity: 'PlatformConfig' })
  @Patch('config')
  @ApiOperation({
    summary: 'Update platform configuration (maintenance mode, toggles)',
  })
  @Message('Platform configuration updated successfully')
  async updatePlatformConfig(
    @Body() dto: UpdatePlatformConfigDto,
  ): Promise<PlatformConfigResponseDto> {
    return this.adminService.updatePlatformConfig(dto);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get high-level platform system metric counts' })
  @Message('System overview retrieved successfully')
  async getSystemOverview() {
    return this.adminService.getSystemOverview();
  }
}
