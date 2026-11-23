import { DiscountCodeScope, Prisma } from '@prisma/client';

type Reader = Pick<Prisma.TransactionClient, 'discountCodeUsage'>;
type Writer = Pick<
  Prisma.TransactionClient,
  'discountCodeUsage' | 'discountCode' | 'discountCodeUserUsage'
>;

/**
 * Who pays for a discount.
 *
 *  - PLATFORM codes are funded by the platform: vendors are paid on the full
 *    pre-discount price.
 *  - VENDOR codes are funded by that vendor: their earnings are reduced by the
 *    discount, because every line a vendor code discounts belongs to that
 *    vendor (see `isLineEligible`).
 *
 * Returns the amount to deduct from each vendor's gross sales before the
 * commission rate is applied. Empty when the order used no vendor-funded code.
 */
export async function loadVendorFundedDiscounts(
  client: Reader,
  orderId: string,
): Promise<Map<string, Prisma.Decimal>> {
  const usages = await client.discountCodeUsage.findMany({
    where: { orderId },
    select: {
      discountAmount: true,
      discountCode: { select: { scope: true, vendorId: true } },
    },
  });

  const shares = new Map<string, Prisma.Decimal>();
  for (const usage of usages) {
    const { scope, vendorId } = usage.discountCode;
    if (scope !== DiscountCodeScope.VENDOR || !vendorId) continue;
    shares.set(
      vendorId,
      (shares.get(vendorId) ?? new Prisma.Decimal(0)).add(usage.discountAmount),
    );
  }
  return shares;
}

/**
 * Vendor earnings for an order: (gross sales - vendor-funded discount) x rate.
 * Never negative. Decimal arithmetic throughout.
 */
export function computeVendorEarnings(
  items: Array<{
    vendorId: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
  }>,
  commissionRate: Prisma.Decimal.Value,
  vendorFundedDiscounts: Map<string, Prisma.Decimal> = new Map(),
): Map<string, Prisma.Decimal> {
  const gross = new Map<string, Prisma.Decimal>();
  for (const item of items) {
    gross.set(
      item.vendorId,
      (gross.get(item.vendorId) ?? new Prisma.Decimal(0)).add(
        item.unitPrice.mul(item.quantity),
      ),
    );
  }

  const earnings = new Map<string, Prisma.Decimal>();
  for (const [vendorId, sales] of gross) {
    const net = Prisma.Decimal.max(
      sales.sub(vendorFundedDiscounts.get(vendorId) ?? 0),
      new Prisma.Decimal(0),
    );
    earnings.set(vendorId, net.mul(commissionRate).toDecimalPlaces(2));
  }
  return earnings;
}

/**
 * Give a redemption back when its order will never be paid: cancelled,
 * expired unpaid, payment failed, or refunded. Without this, abandoned
 * checkouts permanently burn a code's global limit and the shopper's own
 * per-user allowance.
 *
 * Idempotent: deleting the usage row is the idempotency gate, so releasing the
 * same order twice decrements once. Run it inside the transaction that changes
 * the order status.
 */
export async function releaseDiscountUsage(
  tx: Writer,
  orderId: string,
): Promise<void> {
  const usages = await tx.discountCodeUsage.findMany({
    where: { orderId },
    select: { id: true, discountCodeId: true, userId: true },
  });

  for (const usage of usages) {
    const removed = await tx.discountCodeUsage.deleteMany({
      where: { id: usage.id },
    });
    if (removed.count !== 1) continue;

    await tx.discountCode.updateMany({
      where: { id: usage.discountCodeId, usageCount: { gt: 0 } },
      data: { usageCount: { decrement: 1 } },
    });
    await tx.discountCodeUserUsage.updateMany({
      where: {
        discountCodeId: usage.discountCodeId,
        userId: usage.userId,
        usageCount: { gt: 0 },
      },
      data: { usageCount: { decrement: 1 } },
    });
  }
}

/**
 * The commission actually credited to each vendor's pending balance for this
 * order (from the wallet ledger).
 *
 * Settlement and refund reversal must move exactly what was credited rather
 * than re-deriving it, so the ledger always nets to zero even if the earnings
 * formula changes between the credit and the later settlement/refund.
 */
export async function loadCreditedVendorEarnings(
  client: Pick<Prisma.TransactionClient, 'walletTransaction'>,
  orderId: string,
): Promise<Map<string, Prisma.Decimal>> {
  const rows = await client.walletTransaction.findMany({
    where: {
      referenceId: orderId,
      type: 'CREDIT',
      reason: 'COMMISSION',
      vendorWalletId: { not: null },
    },
    select: { amount: true, vendorWallet: { select: { vendorId: true } } },
  });

  const credited = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    const vendorId = row.vendorWallet?.vendorId;
    if (!vendorId) continue;
    credited.set(
      vendorId,
      (credited.get(vendorId) ?? new Prisma.Decimal(0)).add(row.amount),
    );
  }
  return credited;
}
