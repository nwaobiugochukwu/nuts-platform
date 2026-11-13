import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationPriority, NotificationType, ROLE } from '@prisma/client';
import {
  getErrorMessage,
  getErrorStack,
} from '@api/common/utils/error-details.util';
import {
  RABBITMQ_QUEUES,
  RABBITMQ_ROUTING_KEYS,
} from '@api/infrastructure/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/rabbitmq/rabbitmq.service';
import { NotificationsService } from '../notifications.service';

interface VendorFollowedEvent {
  eventId: string;
  userId: string;
  vendorId: string;
}

function parseVendorFollowedEvent(value: unknown): VendorFollowedEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const event = value as Record<string, unknown>;
  if (
    typeof event.eventId !== 'string' ||
    !event.eventId.trim() ||
    typeof event.userId !== 'string' ||
    !event.userId.trim() ||
    typeof event.vendorId !== 'string' ||
    !event.vendorId.trim()
  ) {
    return null;
  }
  return {
    eventId: event.eventId,
    userId: event.userId,
    vendorId: event.vendorId,
  };
}

@Injectable()
export class VendorFollowConsumer implements OnModuleInit {
  private readonly logger = new Logger(VendorFollowConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbitmq.consume<unknown>(
      RABBITMQ_QUEUES.VENDOR_EVENTS,
      async (payload, message) => {
        try {
          const event = parseVendorFollowedEvent(payload);
          const routingKey = message.fields.routingKey;
          const isSupportedRoutingKey =
            routingKey === RABBITMQ_ROUTING_KEYS.VENDOR_FOLLOWED ||
            routingKey === RABBITMQ_ROUTING_KEYS.VENDOR_UNFOLLOWED;
          if (!event || !isSupportedRoutingKey) {
            throw new Error('Malformed vendor follow event');
          }

          // Unfollows are durably recorded for analytics but do not create a
          // vendor notification. Acknowledge the event so it is not discarded
          // as an unroutable publish or retried into the DLQ.
          if (routingKey === RABBITMQ_ROUTING_KEYS.VENDOR_UNFOLLOWED) return;

          await this.notifications.create({
            userId: event.vendorId,
            role: ROLE.VENDOR,
            type: NotificationType.VENDOR_FOLLOWED,
            title: 'New store follower',
            message: 'Your store has a new follower.',
            priority: NotificationPriority.LOW,
            link: '/vendor/analytic',
            metadata: { eventId: event.eventId },
            dedupeKey: `vendor-follow:${event.eventId}`,
          });
        } catch (error: unknown) {
          this.logger.error(
            `Failed to handle vendor follow event: ${getErrorMessage(error)}`,
            getErrorStack(error),
          );
          // Let RabbitMQ route exhausted or malformed deliveries to the DLQ.
          throw error;
        }
      },
    );
  }
}
