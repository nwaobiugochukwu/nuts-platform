import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { EmailTemplatesService } from '@api/infrastructure/mail/email-templates.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { RABBITMQ_QUEUES } from '@api/infrastructure/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/rabbitmq/rabbitmq.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';
import { LOW_STOCK } from '@api/common/constants';
import { generateJobId } from '@api/common/utils';

interface LowStockEmailJob {
  productName: string;
  currentStock: number;
  vendorStoreName: string;
  to: string;
  variantName?: string;
  deduplicationId: string;
}

@Injectable()
export class LowStockCron {
  private readonly logger = new Logger(LowStockCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitMQService,
    private readonly emailTemplates: EmailTemplatesService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
              name: true,
              vendor: {
                select: {
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
          to: product.vendor.email,
          vendorStoreName: product.vendor.storeName,
          productName: product.name,
          currentStock: product.stock,
          deduplicationId: generateJobId('low-stock-product', product.id),
        });
      }

      for (const variant of lowStockVariants) {
        jobs.push({
          to: variant.product.vendor.email,
          vendorStoreName: variant.product.vendor.storeName,
          productName: variant.product.name,
          currentStock: variant.stock,
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
