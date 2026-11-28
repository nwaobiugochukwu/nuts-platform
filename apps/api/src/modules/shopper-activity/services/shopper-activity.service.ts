import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { ROLE } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type {
  ShopperAction,
  ShopperActivity,
} from '../types/shopper-activity.types';
import { ShopperActivityRecorderService } from './shopper-activity-recorder.service';

/** What the caller knows about a cart or wishlist change; the service adds the id and the action. */
export type ShopperItemChange = Omit<ShopperActivity, 'id' | 'action'> & {
  id?: string;
};
export type CartItemChange = ShopperItemChange;
export type WishlistItemChange = ShopperItemChange;

type Result = { accepted: boolean };

/**
 * Records what a shopper does that recommendations learn from: opening a store, adding or removing
 * a cart item, adding or removing a wishlist item. Each has its own method and its own event
 * (`shopper.store_viewed`, `shopper.cart_item_added`, ...), so the caller says what happened instead of
 * filling in a generic "event type".
 *
 * Analytics failures never fail the purchase or the wishlist change that caused them. The event
 * goes to the analytics queue; if the broker is down the row is written here instead, so nothing
 * is lost.
 */
@Injectable()
export class ShopperActivityService {
  private readonly logger = new Logger(ShopperActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recorder: ShopperActivityRecorderService,
  ) {}

  /** A shopper opened a vendor's store page. Not counted: staff, and a vendor viewing their own store. */
  async storeViewed(
    vendorId: string,
    identity: { id: string; visitorId?: string; sessionId?: string },
    userId?: string,
    userRole?: ROLE,
  ): Promise<Result> {
    if (userRole === ROLE.ADMIN || (userId && vendorId === userId)) {
      return { accepted: true };
    }

    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, isActive: true, isApproved: true },
      select: { id: true },
    });
    if (!vendor) return { accepted: false };

    return this.record('store_viewed', {
      id: identity.id,
      vendorId: vendor.id,
      userId: userRole === ROLE.VENDOR ? null : (userId ?? null),
      visitorId:
        identity.visitorId ??
        (userRole === ROLE.VENDOR && userId ? `vendor:${userId}` : null),
      sessionId: identity.sessionId ?? null,
      surface: 'VENDOR_STORE',
    });
  }

  cartItemAdded(change: CartItemChange): Promise<Result> {
    return this.record('cart_item_added', change);
  }

  cartItemRemoved(change: CartItemChange): Promise<Result> {
    return this.record('cart_item_removed', change);
  }

  wishlistItemAdded(change: WishlistItemChange): Promise<Result> {
    return this.record('wishlist_item_added', change);
  }

  wishlistItemRemoved(change: WishlistItemChange): Promise<Result> {
    return this.record('wishlist_item_removed', change);
  }

  private async record(
    action: ShopperAction,
    change: ShopperItemChange,
  ): Promise<Result> {
    const activity: ShopperActivity = {
      ...change,
      id: change.id ?? randomUUID(),
      action,
    };
    try {
      await this.recorder.record(activity);
      return { accepted: true };
    } catch (error) {
      this.logger.warn(
        `Could not record ${action}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { accepted: false };
    }
  }
}
