import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ShopperActivity } from '../types/shopper-activity.types';
import {
  feedRefreshFor,
  storeFor,
  toActivityRow,
  toProductViewRow,
  toSearchRow,
  toShelfRow,
} from '../utils/shopper-activity.mapper';
import { RecommendationRefreshService } from './recommendation-refresh.service';

/** One activity and when it happened. */
export interface StoredActivityInput {
  activity: ShopperActivity;
  occurredAt: Date;
}

/**
 * The one place shopper activity is written to its table. The queue consumer uses it, and so does the
 * direct fallback when the broker is down, so the two can never disagree about what a row looks like.
 *
 * Every row carries the id its activity was given and is inserted with `skipDuplicates`, so saving the
 * same activity again changes nothing. A row that points at something deleted since (a removed user or
 * product) is dropped, or for a product view kept as an anonymous visitor, rather than failing the
 * batch. Any other error is thrown, so the caller can retry: acknowledging a failed insert would
 * silently erase behaviour data.
 *
 * Once rows exist, shoppers whose recommendations they change get their cached shelves cleared and
 * their feed rebuilt, once per burst (`RecommendationRefreshService`).
 */
@Injectable()
export class ShopperActivityStoreService {
  private readonly logger = new Logger(ShopperActivityStoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refresh: RecommendationRefreshService,
  ) {}

  save(
    activity: ShopperActivity,
    occurredAt: Date = new Date(),
  ): Promise<void> {
    return this.saveMany([{ activity, occurredAt }]);
  }

  async saveMany(items: StoredActivityInput[]): Promise<void> {
    if (items.length === 0) return;
    const of = (kind: ReturnType<typeof storeFor>) =>
      items.filter(({ activity }) => storeFor(activity.action) === kind);

    await this.writeRows(
      of('product_views').map(({ activity, occurredAt }) =>
        toProductViewRow(activity, occurredAt),
      ),
      (data) =>
        this.prisma.productView.createMany({ data, skipDuplicates: true }),
      // The user is not in the users table (a vendor browsing as a visitor): keep the view as an
      // anonymous visitor instead of losing it.
      (row) =>
        this.prisma.productView.createMany({
          data: [
            {
              ...row,
              userId: null,
              visitorId:
                row.visitorId ?? (row.userId ? `visitor:${row.userId}` : null),
            },
          ],
          skipDuplicates: true,
        }),
    );
    await this.writeRows(
      of('searches').map(({ activity, occurredAt }) =>
        toSearchRow(activity, occurredAt),
      ),
      (data) =>
        this.prisma.searchQuery.createMany({ data, skipDuplicates: true }),
    );
    await this.writeRows(
      of('shelf').map(({ activity, occurredAt }) =>
        toShelfRow(activity, occurredAt),
      ),
      (data) =>
        this.prisma.recommendationEvent.createMany({
          data,
          skipDuplicates: true,
        }),
    );
    await this.writeRows(
      of('activity').map(({ activity, occurredAt }) =>
        toActivityRow(activity, occurredAt),
      ),
      (data) =>
        this.prisma.shopperActivity.createMany({ data, skipDuplicates: true }),
    );

    for (const { activity } of items) {
      const target = feedRefreshFor(activity);
      if (target) this.refresh.schedule(target.keys, target.actor);
    }
  }

  /**
   * Writes rows as one batch. If the batch points at something deleted (P2003), retries row by row so
   * one bad row cannot take the others with it; `whenMissing` says what to do with a bad row (the
   * default is to drop it).
   */
  private async writeRows<Row>(
    rows: Row[],
    write: (rows: Row[]) => Promise<unknown>,
    whenMissing?: (row: Row) => Promise<unknown>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const handleMissing = async (row: Row) => {
      if (whenMissing) {
        await whenMissing(row);
        return;
      }
      this.logger.warn('Skipped tracking rows that reference a missing row.');
    };
    try {
      await write(rows);
      return;
    } catch (error) {
      if (!isMissingReference(error)) throw error;
      if (rows.length === 1) return handleMissing(rows[0]);
    }
    for (const row of rows) {
      try {
        await write([row]);
      } catch (error) {
        if (!isMissingReference(error)) throw error;
        await handleMissing(row);
      }
    }
  }
}

function isMissingReference(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}
