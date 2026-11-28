import type { Prisma } from '@prisma/client';

/** The name stock adjustments are recorded under in `processed_events`. */
export const STOCK_ADJUSTMENT_CONSUMER = 'stock-adjustment';

/**
 * Makes a stock adjustment safe to send twice. An adjustment is relative ("add 5", "remove 2"), so a
 * request that is retried (a double click, a dropped response, a client retry) would otherwise apply
 * again. The caller gives each intended adjustment one id; the first request with that id records it
 * here, in the SAME transaction as the adjustment, and any later request with the same id finds the
 * record and is told not to apply it.
 *
 * Returns true when the adjustment should be applied: the first time, or whenever no id was given
 * (nothing to recognise it by, so it behaves as it always has). Because the record is written in the
 * adjustment's own transaction, an adjustment that fails leaves no record and can be retried.
 */
export async function claimStockAdjustment(
  tx: Prisma.TransactionClient,
  requestId: string | undefined,
): Promise<boolean> {
  if (!requestId) return true;
  const claimed = await tx.processedEvent.createMany({
    data: [
      {
        consumer: STOCK_ADJUSTMENT_CONSUMER,
        messageId: requestId,
        status: 'DONE',
        completedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
  return claimed.count === 1;
}
