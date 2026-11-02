import {
  Controller,
  Header,
  Headers,
  MessageEvent,
  Query,
  Sse,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ROLE } from '@prisma/client';
import { Observable } from 'rxjs';
import { GetUser } from '@api/modules/shared/decorators/get-user.decorator';
import { BypassResponseInterceptor } from '@api/modules/shared/decorators/bypass-response-interceptor.decorator';
import { Roles } from '@api/modules/shared/decorators/role.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { NotificationsService } from '../notifications.service';

@ApiTags('NOTIFICATIONS - SSE')
@ApiBearerAuth('JWT-auth')
@Roles(ROLE.USER, ROLE.ADMIN, ROLE.VENDOR)
@BypassResponseInterceptor()
@SkipThrottle()
@Controller('notifications/sse/stream')
export class NotificationsSseController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Sse()
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({
    summary: 'Real-time Server-Sent Events stream for user notifications',
    description:
      'Maintains an open SSE connection delivering live in-app notifications and alerts with Last-Event-ID replay support',
  })
  @ApiQuery({
    name: 'lastEventId',
    required: false,
    description: 'Last received notification event ID for offline replay',
  })
  streamNotifications(
    @GetUser() user: AuthenticatedUser,
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
  ): Observable<MessageEvent> {
    const lastEventId = lastEventIdHeader || lastEventIdQuery;
    return this.notificationsService.subscribeToUserStream(
      user.id,
      user.role,
      user.sessionId,
      lastEventId,
    );
  }
}
