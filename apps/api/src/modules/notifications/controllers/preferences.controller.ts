import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '@api/modules/auth/types/authenticated-user.type';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { NotificationPreferencesService } from '../preferences/preferences.service';
import { UpdateNotificationPreferencesDto } from '../preferences/dto/update-preferences.dto';

@ApiTags('NOTIFICATIONS - PREFERENCES')
@ApiBearerAuth('JWT-auth')
@Controller('notifications/preferences')
export class NotificationPreferencesController {
  constructor(
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user notification preferences' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Preferences retrieved' })
  @Message('Notification preferences retrieved successfully')
  async getPreferences(@GetUser() user: AuthenticatedUser) {
    return this.preferencesService.getPreferences(user.id, user.role);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user notification preferences' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Preferences updated' })
  @Message('Notification preferences updated successfully')
  async updatePreferences(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.preferencesService.updatePreferences(user.id, user.role, dto);
  }
}
