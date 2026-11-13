import { Injectable, Logger } from '@nestjs/common';
import { ROLE } from '@prisma/client';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { UpdateNotificationPreferencesDto } from './dto/update-preferences.dto';

export type NotificationChannel = 'email' | 'inApp' | 'push';
export type NotificationCategory =
  | 'orderUpdates'
  | 'paymentAlerts'
  | 'inventoryAlerts'
  | 'socialUpdates'
  | 'marketingPromos'
  | 'securityAlerts';

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves user preferences, automatically initializing default production preferences if not set.
   */
  async getPreferences(userId: string, role: ROLE) {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_role: { userId, role },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.notificationPreference.create({
      data: {
        userId,
        role,
        emailEnabled: true,
        inAppEnabled: true,
        pushEnabled: true,
        orderUpdates: true,
        paymentAlerts: true,
        inventoryAlerts: true,
        socialUpdates: true,
        marketingPromos: false,
      },
    });
  }

  /**
   * Updates user notification preferences atomically.
   */
  async updatePreferences(
    userId: string,
    role: ROLE,
    dto: UpdateNotificationPreferencesDto,
  ) {
    return this.prisma.notificationPreference.upsert({
      where: {
        userId_role: { userId, role },
      },
      create: {
        userId,
        role,
        emailEnabled: dto.emailEnabled ?? true,
        inAppEnabled: dto.inAppEnabled ?? true,
        pushEnabled: dto.pushEnabled ?? true,
        orderUpdates: dto.orderUpdates ?? true,
        paymentAlerts: dto.paymentAlerts ?? true,
        inventoryAlerts: dto.inventoryAlerts ?? true,
        socialUpdates: dto.socialUpdates ?? true,
        marketingPromos: dto.marketingPromos ?? false,
      },
      update: {
        ...(dto.emailEnabled !== undefined && {
          emailEnabled: dto.emailEnabled,
        }),
        ...(dto.inAppEnabled !== undefined && {
          inAppEnabled: dto.inAppEnabled,
        }),
        ...(dto.pushEnabled !== undefined && { pushEnabled: dto.pushEnabled }),
        ...(dto.orderUpdates !== undefined && {
          orderUpdates: dto.orderUpdates,
        }),
        ...(dto.paymentAlerts !== undefined && {
          paymentAlerts: dto.paymentAlerts,
        }),
        ...(dto.inventoryAlerts !== undefined && {
          inventoryAlerts: dto.inventoryAlerts,
        }),
        ...(dto.socialUpdates !== undefined && {
          socialUpdates: dto.socialUpdates,
        }),
        ...(dto.marketingPromos !== undefined && {
          marketingPromos: dto.marketingPromos,
        }),
      },
    });
  }

  /**
   * Evaluates if a notification should be delivered across the requested channel and category.
   * Security alerts (e.g. password reset, fraud lockout) are non-negotiable and always return true.
   */
  async canSend(
    userId: string,
    role: ROLE,
    channel: NotificationChannel,
    category: NotificationCategory,
  ): Promise<boolean> {
    // Security alerts cannot be disabled
    if (category === 'securityAlerts') {
      return true;
    }

    try {
      const prefs = await this.getPreferences(userId, role);

      // 1. Check Master Channel Toggle
      if (channel === 'email' && !prefs.emailEnabled) return false;
      if (channel === 'inApp' && !prefs.inAppEnabled) return false;
      if (channel === 'push' && !prefs.pushEnabled) return false;

      // 2. Check Category Opt-in
      if (category === 'orderUpdates' && !prefs.orderUpdates) return false;
      if (category === 'paymentAlerts' && !prefs.paymentAlerts) return false;
      if (category === 'inventoryAlerts' && !prefs.inventoryAlerts)
        return false;
      if (category === 'socialUpdates' && !prefs.socialUpdates) return false;
      if (category === 'marketingPromos' && !prefs.marketingPromos)
        return false;

      return true;
    } catch (err) {
      this.logger.warn(
        `Failed evaluating notification preference for ${userId}: ${(err as Error).message}. Defaulting to true for delivery.`,
      );
      return true;
    }
  }
}
