import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ROLE } from '@prisma/client';
import webpush, { PushSubscription as WebPushSubscription } from 'web-push';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { getErrorMessage } from '@api/common/utils/error-details.util';

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);
  private isConfigured = false;
  private publicKey = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject =
      this.config.get<string>('VAPID_SUBJECT') ||
      'mailto:ugochukwutemitayo@gmail.com';

    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        this.publicKey = publicKey;
        this.isConfigured = true;
        this.logger.log('WebPush (VAPID) engine initialized successfully.');
      } catch (err) {
        this.logger.warn(
          `Failed initializing WebPush VAPID details: ${getErrorMessage(err)}`,
        );
      }
    } else {
      this.logger.warn(
        'VAPID keys not configured. WebPush will run in no-op mode.',
      );
    }
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  /**
   * Dispatches a push notification to all active devices registered to a user.
   * Automatically cleans up dead subscriptions (410 Gone / 404 Not Found).
   */
  async sendToUser(
    userId: string,
    role: ROLE,
    payload: PushNotificationPayload,
  ): Promise<number> {
    if (!this.isConfigured) return 0;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId, role },
    });

    if (subscriptions.length === 0) return 0;

    const jsonPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icon-192x192.png',
      badge: payload.badge || '/badge-72x72.png',
      url: payload.url || '/',
      data: payload.data || {},
    });

    let delivered = 0;
    const deadEndpoints: string[] = [];

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const pushSubscription: WebPushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(pushSubscription, jsonPayload, {
            TTL: 86400, // 24-hour delivery window
          });
          delivered++;
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          // 404 or 410 indicates the client unregistered or the subscription expired
          if (statusCode === 404 || statusCode === 410) {
            deadEndpoints.push(sub.endpoint);
          } else {
            this.logger.warn(
              `Push notification delivery failed for ${sub.endpoint}: ${getErrorMessage(err)}`,
            );
          }
        }
      }),
    );

    // Prune dead subscriptions asynchronously
    if (deadEndpoints.length > 0) {
      this.prisma.pushSubscription
        .deleteMany({
          where: { endpoint: { in: deadEndpoints } },
        })
        .then((res) => {
          this.logger.log(
            `Pruned ${res.count} expired/unregistered push subscription(s).`,
          );
        })
        .catch(() => undefined);
    }

    return delivered;
  }
}
