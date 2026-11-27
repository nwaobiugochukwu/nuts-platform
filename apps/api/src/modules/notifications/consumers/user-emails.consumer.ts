import { roleCan } from '@api/config/process-role.config';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import { parseEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { ProcessedEventService } from '@api/infrastructure/messaging/idempotency/processed-event.service';
import { PermanentConsumerError } from '@api/infrastructure/messaging/rabbitmq/consumer-retry.util';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { NotificationPriority, NotificationType, ROLE } from '@prisma/client';
import { NotificationsService } from '../services/notifications.service';

const HANDLED_TYPES = [
  DomainEvents.USER_REGISTERED,
  DomainEvents.USER_PASSWORD_CHANGED,
  DomainEvents.USER_LOGIN_FROM_NEW_DEVICE,
] as const;

interface AccountEventPayload {
  userId?: string;
  email?: string;
  firstName?: string | null;
  role?: 'USER' | 'VENDOR';
  device?: string;
  ip?: string | null;
  signedInAt?: string;
}

/**
 * The account emails: welcome, "your password was changed" and "new sign-in from a new device".
 * Each is a consumer of a fact written to the outbox in the transaction that caused it, so a crash
 * cannot lose it and a provider outage only delays it (retries, then the dead-letter queue). A
 * redelivered event does not send the email twice.
 *
 * One-time codes (OTP) are deliberately NOT sent from here: the code must never be written to the
 * outbox, the broker or the dead-letter queue, and a delayed code is useless once it expires.
 */
@Injectable()
export class UserEmailsConsumer implements OnModuleInit {
  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly emails: EmailService,
    private readonly notifications: NotificationsService,
    private readonly processed: ProcessedEventService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<unknown>(
      RABBITMQ_QUEUES.USER_EMAILS,
      async (raw) => {
        const event = parseEnvelope<AccountEventPayload>(raw, {
          type: HANDLED_TYPES,
          supportedVersions: [1],
        });
        const { email } = event.payload;
        if (!email) {
          throw new PermanentConsumerError(`${event.type} has no email`);
        }
        await this.processed.runOnce('user-emails', event.eventId, () =>
          this.dispatch(event.type, event.eventId, event.payload),
        );
      },
    );
  }

  private async dispatch(
    type: string,
    eventId: string,
    payload: AccountEventPayload,
  ): Promise<void> {
    const email = payload.email as string;
    const name = payload.firstName ?? '';

    switch (type) {
      case DomainEvents.USER_REGISTERED:
        await this.emails.sendWelcomeEmail(email, name);
        return;
      case DomainEvents.USER_PASSWORD_CHANGED:
        await this.emails.sendPasswordResetSuccessEmail(email, name);
        return;
      case DomainEvents.USER_LOGIN_FROM_NEW_DEVICE:
        await this.alertNewDevice(eventId, email, name, payload);
        return;
      default:
        throw new PermanentConsumerError(`No handler for ${type}`);
    }
  }

  private async alertNewDevice(
    eventId: string,
    email: string,
    name: string,
    payload: AccountEventPayload,
  ): Promise<void> {
    const device = payload.device ?? 'Unknown device';
    const signedInAt = payload.signedInAt
      ? new Date(payload.signedInAt)
      : new Date();

    await this.emails.sendNewDeviceLoginEmail(email, name, {
      device,
      ip: payload.ip ?? null,
      signedInAt,
    });

    if (payload.userId) {
      // The in-app copy: visible next time they open the app, even if the email is missed.
      await this.notifications.create({
        userId: payload.userId,
        role: ROLE.USER,
        type: NotificationType.SYSTEM_ANNOUNCEMENT,
        title: 'New sign-in to your account',
        message: `Your account was signed in from ${device}. If this was not you, reset your password.`,
        priority: NotificationPriority.HIGH,
        link: '/account',
        metadata: { eventId, device },
        dedupeKey: `SECURITY:new-device:${eventId}`,
        // A security alert is not marketing: preferences must not be able to hide it.
        essential: true,
      });
    }
  }
}
