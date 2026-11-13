import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import type { AuthenticatedUser } from '@api/modules/auth/types/authenticated-user.type';
import { NotificationsService } from '../notifications.service';
import { ListNotificationsQueryDto } from '../dto/list-notifications-query.dto';

@ApiTags('NOTIFICATIONS')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
@Roles(ROLE.USER, ROLE.ADMIN, ROLE.VENDOR)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Message('Notifications retrieved successfully')
  @ApiOperation({
    summary: 'List notifications for current user with cursor pagination',
  })
  async list(
    @GetUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.list(user.id, user.role, {
      cursor: query.cursor,
      limit: query.limit,
      unreadOnly: query.unreadOnly,
      type: query.type,
      category: query.category,
    });
  }

  @Get('unread-count')
  @Message('Unread notification count retrieved successfully')
  @ApiOperation({ summary: 'Get total unread notification count' })
  async getUnreadCount(@GetUser() user: AuthenticatedUser) {
    const count = await this.notificationsService.getUnreadCount(
      user.id,
      user.role,
    );
    return { count };
  }

  @Patch('mark-all-read')
  @Message('All notifications marked as read successfully')
  @ApiOperation({ summary: 'Mark all unread notifications as read' })
  async markAllAsRead(@GetUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllAsRead(user.id, user.role);
  }

  @Delete('clear-all')
  @Message('All read notifications cleared successfully')
  @ApiOperation({ summary: 'Clear all read notifications' })
  async clearAll(@GetUser() user: AuthenticatedUser) {
    return this.notificationsService.clearAll(user.id, user.role);
  }

  @Get(':id')
  @Message('Notification retrieved successfully')
  @ApiOperation({ summary: 'Get a notification for the current user' })
  async getById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.getById(id, user.id, user.role);
  }

  @Patch(':id/read')
  @Message('Notification marked as read successfully')
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markAsRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.markAsRead(id, user.id, user.role);
  }

  @Delete(':id')
  @Message('Notification deleted successfully')
  @ApiOperation({ summary: 'Delete a single notification' })
  async delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.delete(id, user.id, user.role);
  }
}
