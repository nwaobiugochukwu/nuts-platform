import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EmailService } from '../mail/email.service';
import { RABBITMQ_QUEUES } from './rabbitmq.constants';
import { RabbitMQService } from './rabbitmq.service';
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
  ) {}

  async onModuleInit() {
    await this.rabbitmq.consume<EmailQueuePayload>(
      RABBITMQ_QUEUES.EMAILS,
      async (payload) => {
        try {
          if (!payload || !payload.to || !payload.subject) {
            this.logger.warn(
              'Skipping invalid email message from RabbitMQ queue',
            );
            return;
          }

          this.logger.log(
            `Consuming email dispatch to: ${payload.to} [${payload.subject}]`,
          );

          // Delegate to EmailService
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
          throw err; // RabbitMQ will nack and route to DLX after retries
        }
      },
    );
  }
}
