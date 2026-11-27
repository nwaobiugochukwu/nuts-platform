import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { NotificationPriority, NotificationType, ROLE } from '@prisma/client';
import { EmailTemplatesService } from '@api/infrastructure/mail/email-templates.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { REDIS_CLIENT } from '@api/infrastructure/cache/redis.constants';
import { LOW_STOCK } from '@api/common/constants';
import { generateJobId } from '@api/common/utils';
import { NotificationsService } from '@api/modules/notifications/services/notifications.service';
import { NotificationPreferencesService } from '@api/modules/notifications/services/preferences.service';

interface LowStockEmailJob {
  vendorId: string;
  productId: string;
  productName: string;
  currentStock: number;
  vendorStoreName: string;
  to: string;
  variantName?: string;
  deduplicationId: string;
}

@Injectable()
export class LowStockJob {
  private readonly logger = new Logger(LowStockJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitMQService,
    private readonly emailTemplates: EmailTemplatesService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional()
    private readonly preferencesService?: NotificationPreferencesService,
  ) {}

  private formatVariantName(options: unknown): string | undefined {
    if (!options) {
      return undefined;
    }

    if (Array.isArray(options)) {
      const values = options
        .filter(
          (option): option is { name?: unknown; value?: unknown } =>
            typeof option === 'object' && option !== null,
        )
        .map((option) => (typeof option.value === 'string' ? option.value : ''))
        .filter(Boolean);

      return values.length > 0 ? values.join(', ') : undefined;
    }

    if (typeof options === 'object') {
      const values = Object.values(options as Record<string, unknown>).filter(
        (value): value is string => typeof value === 'string',
      );

      return values.length > 0 ? values.join(', ') : undefined;
    }

    return undefined;
  }

  @Cron(LOW_STOCK.CRON_SCHEDULE, {
    name: 'low-stock-alert',
    timeZone: 'Africa/Lagos',
  })
  async handleLowStock(): Promise<void> {
    const startedAt = Date.now();
    const threshold = LOW_STOCK.THRESHOLD;
    const duplicateWindowSeconds = LOW_STOCK.DUPLICATE_WINDOW_HOURS * 60 * 60;

    try {
      const lowStockProducts = await this.prisma.product.findMany({
        where: {
          isActive: true,
          isDeleted: false,
          hasVariants: false,
          stock: {
            gt: 0,
            lt: threshold,
          },
        },
        select: {
          id: true,
          name: true,
          stock: true,
          vendor: {
            select: {
              id: true,
              email: true,
              storeName: true,
            },
          },
        },
      });

      const lowStockVariants = await this.prisma.productVariant.findMany({
        where: {
          isActive: true,
          isDeleted: false,
          stock: {
            gt: 0,
            lt: threshold,
          },
          product: {
            isDeleted: false,
            isActive: true,
            hasVariants: true,
          },
        },
        select: {
          id: true,
          options: true,
          stock: true,
          product: {
            select: {
              id: true,
              name: true,
              vendor: {
                select: {
                  id: true,
                  email: true,
                  storeName: true,
                },
              },
            },
          },
        },
      });

      const jobs: LowStockEmailJob[] = [];

      for (const product of lowStockProducts) {
        jobs.push({
          vendorId: product.vendor.id,
          productId: product.id,
          productName: product.name,
          currentStock: product.stock,
          vendorStoreName: product.vendor.storeName,
          to: product.vendor.email,
          deduplicationId: generateJobId('low-stock-product', product.id),
        });
      }

      for (const variant of lowStockVariants) {
        jobs.push({
          vendorId: variant.product.vendor.id,
          productId: variant.product.id,
          productName: variant.product.name,
          currentStock: variant.stock,
          vendorStoreName: variant.product.vendor.storeName,
          to: variant.product.vendor.email,
          variantName: this.formatVariantName(variant.options),
          deduplicationId: generateJobId('low-stock-variant', variant.id),
        });
      }

      if (jobs.length === 0) {
        this.logger.debug('No low-stock products or variants found');
        return;
      }

      let alertsQueued = 0;

      for (const job of jobs) {
        const dedupKey = `lowstock:${job.deduplicationId}`;
        const alreadySent = await this.redis.get(dedupKey);
        if (alreadySent) {
          continue;
        }

        // 1. In-app / Push notification (checks user preference internally)
        if (this.notifications) {
          try {
            await this.notifications.create({
              userId: job.vendorId,
              role: ROLE.VENDOR,
              type: NotificationType.LOW_STOCK_ALERT,
              title: 'Low Stock Alert',
              message: `${job.productName}${job.variantName ? ` (${job.variantName})` : ''} is running low (${job.currentStock} remaining).`,
              priority: NotificationPriority.HIGH,
              link: '/vendor/products',
              dedupeKey: `lowstock:inapp:${job.deduplicationId}`,
              metadata: {
                productId: job.productId,
                currentStock: job.currentStock,
                variantName: job.variantName,
              },
            });
          } catch (notifErr) {
            this.logger.warn(
              `Failed creating in-app low stock alert for vendor ${job.vendorId}: ${notifErr instanceof Error ? notifErr.message : String(notifErr)}`,
            );
          }
        }

        // 2. Email delivery (respects emailEnabled and inventoryAlerts preferences)
        let canSendEmail = true;
        if (this.preferencesService) {
          canSendEmail = await this.preferencesService.canSend(
            job.vendorId,
            ROLE.VENDOR,
            'email',
            'inventoryAlerts',
          );
        }

        if (canSendEmail) {
          const html = this.emailTemplates.lowStockAlert({
            vendorStoreName: job.vendorStoreName,
            productName: job.productName,
            currentStock: job.currentStock,
            variantName: job.variantName,
          });

          await this.rabbitmq.publish(RABBITMQ_QUEUES.EMAILS, {
            to: job.to,
            subject: `Low Stock Alert - ${job.productName}`,
            html,
            type: 'low_stock_alert',
            metadata: {
              productName: job.productName,
              currentStock: job.currentStock,
              variantName: job.variantName,
            },
          });
        } else {
          this.logger.debug(
            `Skipping low stock email for vendor ${job.vendorId}: opted out of inventoryAlerts or email`,
          );
        }

        await this.redis.set(dedupKey, 'sent', 'EX', duplicateWindowSeconds);
        alertsQueued++;
      }

      this.logger.log(
        {
          alertsQueued,
          products: lowStockProducts.length,
          variants: lowStockVariants.length,
          duplicateWindowHours: LOW_STOCK.DUPLICATE_WINDOW_HOURS,
          durationMs: Date.now() - startedAt,
        },
        'Low stock alert cron completed',
      );
    } catch (error) {
      this.logger.error(
        {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Low stock alert cron failed',
      );

      throw error;
    }
  }
}
