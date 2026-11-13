import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { AuthenticatedUser } from '@api/modules/auth/types/authenticated-user.type';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Public } from '@api/common/decorators/public.decorator';
import { WebPushService } from '../push/push.service';
import { SubscribePushDto } from '../push/dto/subscribe-push.dto';
import { UnsubscribePushDto } from '../push/dto/unsubscribe-push.dto';
import { NotificationPreferencesService } from '../preferences/preferences.service';

@ApiTags('NOTIFICATIONS - PUSH')
@Controller('notifications/push')
export class PushSubscriptionsController {
  constructor(
    private readonly webPushService: WebPushService,
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  @Public()
  @Get('vapid-key')
  @ApiOperation({
    summary: 'Get public VAPID key for browser push registration',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Public VAPID key retrieved',
  })
  @Message('VAPID public key retrieved successfully')
  getVapidKey(): { publicKey: string } {
    return { publicKey: this.webPushService.getPublicKey() };
  }

  @Get('status')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get this device push subscription and preference state',
  })
  async getStatus(
    @GetUser() user: AuthenticatedUser,
    @Query('endpoint') endpoint?: string,
  ): Promise<{ registered: boolean; pushEnabled: boolean }> {
    const [subscription, preferences] = await Promise.all([
      endpoint
        ? this.prisma.pushSubscription.findFirst({
            where: { endpoint, userId: user.id, role: user.role },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.preferences.getPreferences(user.id, user.role),
    ]);
    return {
      registered: Boolean(subscription),
      pushEnabled: preferences.pushEnabled,
    };
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Register browser WebPush subscription for user' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Push subscription saved',
  })
  @Message('Push subscription registered successfully')
  async subscribe(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: SubscribePushDto,
  ) {
    const subscription = await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId: user.id,
        role: user.role,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: dto.userAgent,
      },
      update: {
        userId: user.id,
        role: user.role,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: dto.userAgent,
      },
    });

    return {
      id: subscription.id,
      endpoint: subscription.endpoint,
      createdAt: subscription.createdAt,
    };
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Unregister browser WebPush subscription' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Push subscription removed',
  })
  @Message('Push subscription removed successfully')
  async unsubscribe(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UnsubscribePushDto,
  ) {
    await this.prisma.pushSubscription.deleteMany({
      where: {
        endpoint: dto.endpoint,
        userId: user.id,
        role: user.role,
      },
    });

    return { success: true };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Send a test push notification to user registered devices',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Test push notification dispatched',
  })
  @Message('Test push notification sent successfully')
  async sendTestPush(@GetUser() user: AuthenticatedUser) {
    const delivered = await this.webPushService.sendToUser(user.id, user.role, {
      title: 'NUTS Push Notifications Active',
      body: 'Your device is connected! You will receive real-time order, payment, and security alerts.',
      icon: '/icon-192x192.png',
      url: '/notifications',
      data: {
        type: 'SYSTEM_ANNOUNCEMENT',
        timestamp: Date.now(),
      },
    });

    return { delivered, message: `Push sent to ${delivered} active device(s)` };
  }
}
