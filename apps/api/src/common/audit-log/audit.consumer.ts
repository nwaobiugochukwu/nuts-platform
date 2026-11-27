import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { roleCan } from '@api/config/process-role';
import { Batcher } from './audit-batcher';
import type { AuditEvent } from './audit-event';
import { AuditWriter } from './audit-writer';

/**
 * Writes queued audit events to the database in small batches. A message is
 * acknowledged only after its row is stored; redelivery is harmless because
 * the eventId is unique.
 */
@Injectable()
export class AuditConsumer implements OnModuleInit {
  private readonly logger = new Logger(AuditConsumer.name);
  private readonly batcher: Batcher<AuditEvent>;

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly writer: AuditWriter,
  ) {
    this.batcher = new Batcher<AuditEvent>({
      maxSize: 50,
      maxWaitMs: 250,
      flush: (events) => this.writer.writeBatch(events),
    });
  }

  async onModuleInit(): Promise<void> {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<AuditEvent>(
      RABBITMQ_QUEUES.AUDIT,
      async (event) => {
        if (!event?.eventId || !event.action || !event.entity) {
          this.logger.warn('Skipping malformed audit message');
          return;
        }
        await this.batcher.add(event);
      },
    );
  }
}
