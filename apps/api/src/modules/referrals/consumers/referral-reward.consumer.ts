import { roleCan } from '@api/config/process-role.config';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import { parseEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { ProcessedEventService } from '@api/infrastructure/messaging/idempotency/processed-event.service';
import { PermanentConsumerError } from '@api/infrastructure/messaging/rabbitmq/consumer-retry.util';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ReferralService } from '../services/referral.service';

/**
 * Grants the referral rewards when an order is delivered. It used to be a fire-and-forget call
 * after the status change, so a crash in between skipped the reward for good. Now it consumes
 * `order.delivered` (written in the same transaction as the status change), retried and
 * de-duplicated by event id. The grant itself is also idempotent on its own: the referral is
 * claimed (`rewardGranted` false to true) inside the same serializable transaction as the wallet
 * credits, so even a replay of the event, or a second delivered order, can never pay twice.
 */
@Injectable()
export class ReferralRewardConsumer implements OnModuleInit {
  constructor(
    private readonly rabbit: RabbitMQService,
    private readonly referrals: ReferralService,
    private readonly processed: ProcessedEventService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbit.consume<unknown>(
      RABBITMQ_QUEUES.REFERRAL_REWARDS,
      async (raw) => {
        const event = parseEnvelope<{ orderId?: string; userId?: string }>(
          raw,
          { type: DomainEvents.ORDER_DELIVERED, supportedVersions: [1] },
        );
        const { orderId, userId } = event.payload;
        if (!orderId || !userId) {
          throw new PermanentConsumerError(
            'order.delivered has no orderId or userId',
          );
        }
        await this.processed.runOnce('referral-rewards', event.eventId, () =>
          this.referrals.grantReferralRewards(orderId, userId),
        );
      },
    );
  }
}
