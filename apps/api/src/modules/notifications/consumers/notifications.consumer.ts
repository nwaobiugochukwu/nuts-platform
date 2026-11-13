import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationPriority, NotificationType, ROLE } from '@prisma/client';
import {
  getErrorMessage,
  getErrorStack,
} from '@api/common/utils/error-details.util';
import { RABBITMQ_QUEUES } from '@api/infrastructure/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/rabbitmq/rabbitmq.service';
import { NotificationsService } from '../notifications.service';

interface NotificationMessage {
  eventId?: string;
  userId: string;
  type: NotificationType;
  priority: NotificationPriority;
  role: ROLE;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNotificationMessage(value: unknown): NotificationMessage | null {
  // Older order.confirmed outbox rows only carried the customer and message;
  // translate them during rolling deployments instead of repeatedly DLQing them.
  if (
    isRecord(value) &&
    typeof value.userId === 'string' &&
    typeof value.orderId === 'string' &&
    value.title === 'Order Confirmed' &&
    typeof value.message === 'string' &&
    typeof value.type !== 'string'
  ) {
    return {
      userId: value.userId,
      type: NotificationType.ORDER_CONFIRMED,
      priority: NotificationPriority.HIGH,
      role: ROLE.USER,
      title: value.title,
      message: value.message,
      link: `/order/${value.orderId}`,
      metadata: { orderId: value.orderId },
      dedupeKey: `ORDER_CONFIRMED:${value.orderId}:USER:${value.userId}`,
    };
  }

  if (
    !isRecord(value) ||
    typeof value.userId !== 'string' ||
    !value.userId.trim()
  ) {
    return null;
  }

  // Type validation: must be a recognized NotificationType
  if (
    typeof value.type !== 'string' ||
    !Object.values(NotificationType).includes(value.type as NotificationType)
  ) {
    return null;
  }

  const role =
    typeof value.role === 'string' &&
    Object.values(ROLE).includes(value.role as ROLE)
      ? (value.role as ROLE)
      : ROLE.USER;

  const priority =
    typeof value.priority === 'string' &&
    Object.values(NotificationPriority).includes(
      value.priority as NotificationPriority,
    )
      ? (value.priority as NotificationPriority)
      : NotificationPriority.MEDIUM;

  const title =
    typeof value.title === 'string' && value.title.trim()
      ? value.title.trim()
      : 'New Notification';

  const message = typeof value.message === 'string' ? value.message : '';

  const link = typeof value.link === 'string' ? value.link : undefined;
  const dedupeKey =
    typeof value.dedupeKey === 'string' ? value.dedupeKey : undefined;
  const eventId =
    typeof value.eventId === 'string' ? value.eventId.trim() : undefined;
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;

  return {
    userId: value.userId,
    eventId,
    type: value.type as NotificationType,
    priority,
    role,
    title,
    message,
    link,
    metadata,
    dedupeKey,
  };
}

@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.rabbitmq.consume<unknown>(
      RABBITMQ_QUEUES.NOTIFICATIONS,
      async (rawPayload: unknown) => {
        try {
          const payload = parseNotificationMessage(rawPayload);
          if (!payload) {
            this.logger.error(
              { rawPayload },
              'Rejecting invalid notification message payload to DLQ for operational review',
            );
            throw new Error('Malformed or incomplete notification message');
          }

          await this.notificationsService.create({
            userId: payload.userId,
            role: payload.role,
            type: payload.type,
            title: payload.title,
            message: payload.message,
            priority: payload.priority,
            link: payload.link,
            metadata: payload.metadata,
            dedupeKey:
              payload.dedupeKey ||
              (payload.eventId ? `outbox:${payload.eventId}` : undefined),
          });
        } catch (err: unknown) {
          this.logger.error(
            `Failed to handle notification message: ${getErrorMessage(err)}`,
            getErrorStack(err),
          );
          // Re-throw so RabbitMQService triggers nack(false, false) routing to DLX / DLQ
          throw err;
        }
      },
    );
  }
}
