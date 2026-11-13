import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationPriority, NotificationType, ROLE } from '@prisma/client';
import Redis from 'ioredis';
import { EmailTemplatesService } from '@api/infrastructure/mail/email-templates.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { RABBITMQ_QUEUES } from '@api/infrastructure/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/rabbitmq/rabbitmq.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';
import { ABANDONED_CART } from '@api/common/constants';
import {
  getErrorCode,
  getErrorMessage,
} from '@api/common/utils/error-details.util';

@Injectable()
export class AbandonedCartCron {
  private readonly logger = new Logger(AbandonedCartCron.name);
  private readonly batchSize = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitMQService,
    private readonly emailTemplates: EmailTemplatesService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron(ABANDONED_CART.CRON_SCHEDULE, {
    name: 'abandoned-cart-reminder',
    timeZone: 'Africa/Lagos',
  })
  async handleAbandonedCarts(): Promise<void> {
    const startedAt = Date.now();
    const now = new Date();

    const firstThreshold = new Date(
      now.getTime() - ABANDONED_CART.FIRST_REMINDER_HOURS * 60 * 60 * 1000,
    );
    // Upper bound cutoff: don't alert carts abandoned more than 7 days ago
    const maxAgeCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    try {
      const carts = await this.prisma.cart.findMany({
        where: {
          checkedOut: false,
          abandonedCartAlerted: false,
          updatedAt: {
            lte: firstThreshold,
            gte: maxAgeCutoff,
          },
          cartItems: {
            some: {},
          },
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
            },
          },
          cartItems: {
            select: {
              quantity: true,
              totalPrice: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: this.batchSize,
      });

      if (carts.length === 0) {
        this.logger.debug('No abandoned carts eligible for processing');
        return;
      }

      let queued = 0;

      for (const cart of carts) {
        // Redis deduplication check: avoid spamming the user within 72 hours
        const dedupKey = `cart:reminder:${cart.id}:first`;
        const alreadySent = await this.redis.get(dedupKey);
        if (alreadySent) {
          await this.prisma.cart
            .update({
              where: { id: cart.id },
              data: { abandonedCartAlerted: true },
            })
            .catch(() => null);
          continue;
        }

        const totalAmount = cart.cartItems.reduce(
          (sum, item) => sum + Number(item.totalPrice),
          0,
        );
        const itemCount = cart.cartItems.reduce(
          (sum, item) => sum + item.quantity,
          0,
        );

        const html = this.emailTemplates.abandonedCartReminder({
          firstName: cart.user.firstName,
          itemCount,
          totalAmount,
          currency: 'NGN',
          reminderType: 'first',
        });

        // 1. Dispatch email through RabbitMQ fabric
        await this.rabbitmq.publish(RABBITMQ_QUEUES.EMAILS, {
          to: cart.user.email,
          subject: 'You left something in your cart!',
          html,
          type: 'abandoned_cart',
          metadata: { cartId: cart.id, userId: cart.userId },
        });

        // 2. Dispatch in-app notification through RabbitMQ fabric
        await this.rabbitmq.publish(RABBITMQ_QUEUES.NOTIFICATIONS, {
          userId: cart.userId,
          role: ROLE.USER,
          type: NotificationType.SYSTEM_ANNOUNCEMENT,
          title: 'Items waiting in your cart!',
          message:
            'You have items saved in your cart. Check them out before they sell out.',
          priority: NotificationPriority.LOW,
          link: '/cart',
          metadata: { cartId: cart.id },
        });

        // Mark alerted in DB and set Redis dedup key for 72 hours
        await this.prisma.cart
          .update({
            where: { id: cart.id },
            data: { abandonedCartAlerted: true },
          })
          .catch(() => null);

        await this.redis.set(dedupKey, 'sent', 'EX', 72 * 60 * 60);
        queued++;
      }

      this.logger.log(
        {
          discovered: carts.length,
          queued,
          durationMs: Date.now() - startedAt,
        },
        'Abandoned cart cron completed',
      );
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      if (
        getErrorCode(error) === 'P2021' ||
        (errorMessage.includes('carts') &&
          errorMessage.includes('does not exist'))
      ) {
        this.logger.warn(
          'Table public.carts does not exist yet. Abandoned cart cron is idling until migrations run.',
        );
        return;
      }

      this.logger.error(
        {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Abandoned cart cron failed',
      );
    }
  }
}
