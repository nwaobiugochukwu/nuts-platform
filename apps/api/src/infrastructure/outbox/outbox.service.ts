import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxRelay } from './outbox.relay';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly outboxRelay?: OutboxRelay,
  ) {}

  /**
   * Appends an outbox event inside an ongoing database transaction.
   * Guarantees atomic business mutation + event persistence.
   */
  async appendEvent(
    tx: Prisma.TransactionClient,
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const eventId = randomUUID();
    await tx.outboxEvent.create({
      data: {
        id: eventId,
        aggregateType,
        aggregateId,
        eventType,
        // Keep the event identity in the message so consumers can safely
        // deduplicate deliveries across retries and broker redeliveries.
        payload: { ...payload, eventId },
        status: OutboxStatus.PENDING,
      },
    });

    this.outboxRelay?.notifyNewEvent();
  }
}
