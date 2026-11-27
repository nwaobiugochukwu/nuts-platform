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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {} from 'express';
import { ROLE } from '@prisma/client';
import { Roles } from '@api/common/decorators/role.decorator';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import {} from '@api/common/utils/request.util';
import { StaffService } from '../services/staff.service';
import {
  AdminStaffResponseDto,
  CreateAdminStaffDto,
  QueryAdminStaffDto,
  UpdateAdminStaffStatusDto,
} from '../dto/admin-staff.dto';
import { Audit } from '@api/modules/audit/decorators/audit.decorator';

@ApiTags('ADMIN - STAFF GOVERNANCE')
@ApiBearerAuth()
@Roles(ROLE.ADMIN)
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'List platform admin staff with pagination' })
  @Message('Admin staff retrieved successfully')
  async getStaffList(@Query() query: QueryAdminStaffDto) {
    return this.staffService.getStaffList(query);
  }

  @Audit({ action: 'ADMIN_STAFF_CREATED', entity: 'Admin' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new admin staff member' })
  @Message('Admin staff created successfully')
  async createStaff(
    @Body() dto: CreateAdminStaffDto,
  ): Promise<AdminStaffResponseDto> {
    return this.staffService.createStaff(dto);
  }

  @Audit({ action: 'ADMIN_STAFF_ACTIVATED', entity: 'Admin', entityId: 'id' })
  @Patch(':id/status')
  @ApiOperation({ summary: 'Update admin staff active status' })
  @Message('Admin staff status updated successfully')
  async updateStaffStatus(
    @Param('id') targetAdminId: string,
    @Body() dto: UpdateAdminStaffStatusDto,
    @GetUser('id') performingAdminId: string,
  ): Promise<AdminStaffResponseDto> {
    return this.staffService.updateStaffStatus(
      targetAdminId,
      dto,
      performingAdminId,
    );
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Get governance audit log events' })
  @Message('Governance audit logs retrieved successfully')
  async getAuditLogs(@Query('limit') limit?: number) {
    return this.staffService.getGovernanceAuditLogs(limit ? Number(limit) : 50);
  }
}
