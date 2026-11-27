import { currentRequestId } from '@api/common/request-context/request-context.util';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { buildEnvelope } from '../events/event-envelope.util';
import type { PublishEventInput } from '../events/event-envelope.types';
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
    options: { wakeRelay?: boolean } = {},
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
        // The request that caused this event, so the relay can put it back on the message.
        payload: {
          ...payload,
          eventId,
          ...(currentRequestId() && !('requestId' in payload)
            ? { requestId: currentRequestId() }
            : {}),
        },
        status: OutboxStatus.PENDING,
      },
    });

    // Callers inside TransactionRunnerService pass wakeRelay: false and wake the relay
    // after COMMIT; waking it here would race the commit.
    if (options.wakeRelay !== false) this.outboxRelay?.notifyNewEvent();
  }

  /**
   * Appends a domain event, wrapped in the standard envelope (ADR 0007), inside an ongoing
   * transaction: it exists if and only if the business change commits. The event type is also
   * the routing key, and the outbox row id is the event id.
   */
  async appendEnvelope<T extends object>(
    tx: Prisma.TransactionClient,
    input: PublishEventInput<T>,
    options: { wakeRelay?: boolean } = {},
  ): Promise<string> {
    const eventId = randomUUID();
    const envelope = buildEnvelope(input, {
      eventId,
      requestId: currentRequestId(),
    });
    await tx.outboxEvent.create({
      data: {
        id: eventId,
        aggregateType: input.aggregate.type,
        aggregateId: input.aggregate.id,
        eventType: input.type,
        payload: envelope as unknown as Prisma.InputJsonValue,
        status: OutboxStatus.PENDING,
      },
    });
    if (options.wakeRelay !== false) this.outboxRelay?.notifyNewEvent();
    return eventId;
  }

  /** Wakes the relay now; call after the transaction that appended events committed. */
  wakeRelay(): void {
    this.outboxRelay?.notifyNewEvent();
  }
}
