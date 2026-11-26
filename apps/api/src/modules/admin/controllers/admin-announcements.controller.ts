import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import type {} from 'express';
import {} from '@api/common/utils/request.util';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { AdminAnnouncementsService } from '../admin-announcements.service';
import {
  CreateAdminAnnouncementDto,
  QueryAdminAnnouncementsDto,
  ScheduleAdminAnnouncementDto,
  UpdateAdminAnnouncementDto,
} from '../dto/admin-announcement.dto';
import { Audit } from '@api/common/audit-log/audit.decorator';

@ApiTags('ADMIN - ANNOUNCEMENTS')
@ApiBearerAuth()
@Roles(ROLE.ADMIN)
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AdminAnnouncementsService) {}

  @Get()
  @ApiOperation({ summary: 'List customer and vendor announcement campaigns' })
  @Message('Announcements retrieved successfully')
  list(@Query() query: QueryAdminAnnouncementsDto) {
    return this.announcements.list(query);
  }

  @Get('audience-counts')
  @ApiOperation({ summary: 'Get active customer and vendor audience sizes' })
  @Message('Announcement audience counts retrieved successfully')
  getAudienceCounts() {
    return this.announcements.getAudienceCounts();
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get announcement audience and campaign totals' })
  @Message('Announcement overview retrieved successfully')
  getOverview() {
    return this.announcements.getOverview();
  }

  @Audit({ action: 'ANNOUNCEMENT_DRAFT_CREATED', entity: 'Announcement' })
  @Post()
  @ApiOperation({ summary: 'Create an announcement draft' })
  @Message('Announcement draft created successfully')
  create(
    @Body() dto: CreateAdminAnnouncementDto,
    @GetUser('id') adminId: string,
  ) {
    return this.announcements.createDraft(dto, adminId);
  }

  @Audit({ action: 'ANNOUNCEMENT_DRAFT_UPDATED', entity: 'Announcement' })
  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft or scheduled announcement' })
  @Message('Announcement updated successfully')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminAnnouncementDto,
  ) {
    return this.announcements.updateDraft(id, dto);
  }

  @Audit({ action: 'ANNOUNCEMENT_PUBLISH_STARTED', entity: 'Announcement' })
  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish an announcement to its selected audience' })
  @Message('Announcement delivery started')
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.publishNow(id);
  }

  @Audit({ action: 'ANNOUNCEMENT_SCHEDULED', entity: 'Announcement' })
  @Post(':id/schedule')
  @ApiOperation({ summary: 'Schedule an announcement for future delivery' })
  @Message('Announcement scheduled successfully')
  schedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleAdminAnnouncementDto,
  ) {
    return this.announcements.schedule(id, dto);
  }

  @Audit({ action: 'ANNOUNCEMENT_ARCHIVED', entity: 'Announcement' })
  @Post(':id/archive')
  @ApiOperation({
    summary: 'Archive a completed, draft, or failed announcement',
  })
  @Message('Announcement archived successfully')
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.archive(id);
  }
}
