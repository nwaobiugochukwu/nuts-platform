import { ConflictException } from '@nestjs/common';

export const INSUFFICIENT_STOCK_ERROR_CODE = 'INSUFFICIENT_STOCK' as const;

/**
 * One line that could not be satisfied from live inventory.
 *
 * `available` is the authoritative stock observed inside the failing
 * transaction (or at validation time for cart mutations). It is a
 * point-in-time value — clients must treat it as a hint, not a reservation.
 */
export interface StockShortfallItem {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  requested: number;
  available: number;
}

/**
 * Domain exception for stock conflicts (HTTP 409).
 *
 * 409 Conflict is used instead of 400 because the request is well-formed —
 * it conflicts with the current state of the inventory resource, and the
 * same request may succeed later (e.g. after an unpaid order expires).
 *
 * Serialized by GlobalExceptionFilter as:
 *   { success: false, message, error: { code: 'INSUFFICIENT_STOCK', meta: { items } } }
 */
export class InsufficientStockException extends ConflictException {
  readonly items: StockShortfallItem[];

  constructor(items: StockShortfallItem[], message?: string) {
    super({
      code: INSUFFICIENT_STOCK_ERROR_CODE,
      message: message ?? InsufficientStockException.buildMessage(items),
      meta: { items },
    });
    this.items = items;
  }

  private static buildMessage(items: StockShortfallItem[]): string {
    if (items.length === 1) {
      const [item] = items;
      const label = item.variantLabel
        ? `"${item.name}" (${item.variantLabel})`
        : `"${item.name}"`;

      return item.available <= 0
        ? `${label} is out of stock.`
        : `Only ${item.available} of ${label} available (requested ${item.requested}).`;
    }

    return `${items.length} items in your cart are no longer available in the requested quantity.`;
  }
}
