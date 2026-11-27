import { roleCan } from '@api/config/process-role.config';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EmailService } from '../../../infrastructure/mail/email.service';
import { RABBITMQ_QUEUES } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { PermanentConsumerError } from '../../../infrastructure/messaging/rabbitmq/consumer-retry.util';
import { ProcessedEventService } from '../../../infrastructure/messaging/idempotency/processed-event.service';
import { RabbitMQService } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.service';
import {
  getErrorMessage,
  getErrorStack,
} from '@api/common/utils/error-details.util';

export interface EmailQueuePayload {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class EmailConsumer implements OnModuleInit {
  private readonly logger = new Logger(EmailConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly emailService: EmailService,
    private readonly processed: ProcessedEventService,
  ) {}

  async onModuleInit() {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<EmailQueuePayload>(
      RABBITMQ_QUEUES.EMAILS,
      async (payload, message) => {
        if (!payload || !payload.to || !payload.subject) {
          // Can never succeed: dead-letter it for inspection instead of dropping it silently.
          throw new PermanentConsumerError(
            'Invalid email message: "to" and "subject" are required',
          );
        }
        // A redelivered message must not send the email a second time.
        await this.processed.runOnce(
          'email',
          message?.properties?.messageId as string | undefined,
          () => this.send(payload),
        );
      },
    );
  }

  private async send(payload: EmailQueuePayload): Promise<void> {
    try {
      this.logger.log(
        `Consuming email dispatch to: ${payload.to} [${payload.subject}]`,
      );

      // sendEmail handles circuit-breaker protection and Brevo delivery.
      await this.emailService.sendEmail({
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      });
    } catch (err: unknown) {
      this.logger.error(
        `Failed to process email message: ${getErrorMessage(err)}`,
        getErrorStack(err),
      );
      throw err; // the queue retries it with a delay, then dead-letters it
    }
  }
}
