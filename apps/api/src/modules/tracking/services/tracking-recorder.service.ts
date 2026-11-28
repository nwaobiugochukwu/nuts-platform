import { Injectable } from '@nestjs/common';
import type { ShopperActivity } from '../types/tracking.types';
import { TrackingPublisherService } from './tracking-publisher.service';
import { TrackingStoreService } from './tracking-store.service';

/** An activity to record and, when it happened earlier than now, when. */
export interface RecordedActivityInput {
  activity: ShopperActivity;
  occurredAt?: Date;
}

/**
 * How shopper activity is taken in: put it on the analytics queue so no request waits for a database
 * write, and if the broker cannot take it, store it right away through the same store the queue
 * consumer uses. Either way the activity ends up stored exactly once (its id makes a repeat a
 * no-op), and a request never depends on RabbitMQ being up.
 *
 * Resolves when every activity is queued or stored; throws when one could be neither, so the caller
 * can say it was not accepted.
 */
@Injectable()
export class TrackingRecorderService {
  constructor(
    private readonly publisher: TrackingPublisherService,
    private readonly store: TrackingStoreService,
  ) {}

  record(
    activity: ShopperActivity,
    options: { occurredAt?: Date } = {},
  ): Promise<void> {
    return this.recordMany([{ activity, occurredAt: options.occurredAt }]);
  }

  async recordMany(items: RecordedActivityInput[]): Promise<void> {
    const queued = await Promise.all(
      items.map(({ activity, occurredAt }) =>
        this.publisher.record(activity, { occurredAt }),
      ),
    );
    const unqueued = items.filter((_, index) => !queued[index]);
    if (unqueued.length === 0) return;
    await this.store.saveMany(
      unqueued.map(({ activity, occurredAt }) => ({
        activity,
        occurredAt: occurredAt ?? new Date(),
      })),
    );
  }
}
