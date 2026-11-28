/**
 * Shopper activity: everything a shopper does that analytics and recommendations learn from.
 *
 * It is one concept with one type. An activity says WHO did it (a user, or a guest by visitor and
 * session), WHAT they did (`action`), what it was done TO (a product, a store, a category, a search
 * text), WHERE (`surface`), and WHEN (the envelope's `occurredAt`). Only the few fields that apply
 * to an action are filled in; `missingFields` in the mapper says which, per action.
 *
 * On the queue each action is its own routing key, `shopper.<action>` (ADR 0007), so a dead
 * letter or a binding reads as what happened. The message body is the activity without `action`.
 */

export const SHOPPER_ACTIONS = [
  'product_viewed',
  'searched',
  'store_viewed',
  'cart_item_added',
  'cart_item_removed',
  'wishlist_item_added',
  'wishlist_item_removed',
  'shelf_item_seen',
  'shelf_item_clicked',
  'shelf_item_dismissed',
  'category_viewed',
] as const;

export type ShopperAction = (typeof SHOPPER_ACTIONS)[number];

/** Who did it. A signed-in shopper has a user id; a guest only a visitor and a session id. */
export interface ShopperIdentity {
  userId?: string | null;
  visitorId?: string | null;
  sessionId?: string | null;
}

export interface ShopperActivity extends ShopperIdentity {
  /** The id of the row this becomes: the guard that makes a redelivery a no-op. */
  id: string;
  action: ShopperAction;
  /** Where in the storefront: `CART`, `WISHLIST`, `VENDOR_STORE`, `HOME_FOR_YOU`, ... */
  surface?: string | null;

  // What it was done to.
  productId?: string | null;
  vendorId?: string | null;
  variantId?: string | null;
  categoryId?: string | null;
  cartId?: string | null;

  /** Cart actions: how many units were added or removed (not what is left in the cart). */
  quantity?: number | null;

  /** `searched`: what they typed and how many results it found. */
  query?: string;
  resultsCount?: number;

  /** Shelf and category actions: which request showed it, at which position, ranked by what. */
  requestId?: string | null;
  rankerVersion?: string | null;
  position?: number | null;
}

/** The message body for an activity: everything but the action, which is the routing key. */
export type ShopperActivityBody = Omit<ShopperActivity, 'action'>;
