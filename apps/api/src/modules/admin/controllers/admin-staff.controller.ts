import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
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
  AdminStaffResponseDto,
  CreateAdminStaffDto,
  QueryAdminStaffDto,
  UpdateAdminStaffStatusDto,
} from '../dto/admin-staff.dto';

@ApiTags('ADMIN - STAFF GOVERNANCE')
@ApiBearerAuth()
@Roles(ROLE.ADMIN)
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'List platform admin staff with pagination' })
  @Message('Admin staff retrieved successfully')
  async getStaffList(@Query() query: QueryAdminStaffDto) {
    return this.adminService.getStaffList(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new admin staff member' })
  @Message('Admin staff created successfully')
  async createStaff(
    @Body() dto: CreateAdminStaffDto,
    @GetUser('id') creatorId: string,
    @Req() req: Request,
  ): Promise<AdminStaffResponseDto> {
    return this.adminService.createStaff(
      dto,
      creatorId,
      extractIpAddress(req),
      extractUserAgent(req),
    );
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update admin staff active status' })
  @Message('Admin staff status updated successfully')
  async updateStaffStatus(
    @Param('id') targetAdminId: string,
    @Body() dto: UpdateAdminStaffStatusDto,
    @GetUser('id') performingAdminId: string,
    @Req() req: Request,
  ): Promise<AdminStaffResponseDto> {
    return this.adminService.updateStaffStatus(
      targetAdminId,
      dto,
      performingAdminId,
      extractIpAddress(req),
      extractUserAgent(req),
    );
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Get governance audit log events' })
  @Message('Governance audit logs retrieved successfully')
  async getAuditLogs(@Query('limit') limit?: number) {
    return this.adminService.getGovernanceAuditLogs(limit ? Number(limit) : 50);
  }
}
