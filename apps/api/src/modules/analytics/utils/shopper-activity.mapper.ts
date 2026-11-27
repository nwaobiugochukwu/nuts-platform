import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import type { Prisma } from '@prisma/client';
import type { FeedActor } from '../services/recommendation-refresh.service';
import {
  SHOPPER_ACTIONS,
  type ShopperAction,
  type ShopperActivity,
  type ShopperActivityBody,
  type ShopperIdentity,
} from '../types/shopper-activity.types';

/**
 * The rules that apply to shopper activity as a whole: its event names, what each action needs, who
 * it is about, which actions change what to recommend, and the translation to the stored tables.
 * The tables' `event_type` columns predate the event names and use their own labels; those labels
 * appear in this file and nowhere else.
 */

/** The event name of every action. The record makes the compiler reject a missing or extra one. */
const EVENT_BY_ACTION: Record<ShopperAction, string> = {
  product_viewed: DomainEvents.SHOPPER_PRODUCT_VIEWED,
  searched: DomainEvents.SHOPPER_SEARCHED,
  store_viewed: DomainEvents.SHOPPER_STORE_VIEWED,
  cart_item_added: DomainEvents.SHOPPER_CART_ITEM_ADDED,
  cart_item_removed: DomainEvents.SHOPPER_CART_ITEM_REMOVED,
  wishlist_item_added: DomainEvents.SHOPPER_WISHLIST_ITEM_ADDED,
  wishlist_item_removed: DomainEvents.SHOPPER_WISHLIST_ITEM_REMOVED,
  shelf_item_seen: DomainEvents.SHOPPER_SHELF_ITEM_SEEN,
  shelf_item_clicked: DomainEvents.SHOPPER_SHELF_ITEM_CLICKED,
  shelf_item_dismissed: DomainEvents.SHOPPER_SHELF_ITEM_DISMISSED,
  category_viewed: DomainEvents.SHOPPER_CATEGORY_VIEWED,
};

export const SHOPPER_ACTIVITY_EVENTS: string[] = SHOPPER_ACTIONS.map(
  (action) => EVENT_BY_ACTION[action],
);

export function eventNameFor(action: ShopperAction): string {
  return EVENT_BY_ACTION[action];
}

/** The action an event name stands for, or undefined if it is not shopper activity. */
export function actionForEvent(name: string): ShopperAction | undefined {
  return SHOPPER_ACTIONS.find((action) => EVENT_BY_ACTION[action] === name);
}

/**
 * Every shopper-activity event is about the shopper: a signed-in shopper by their user id, a guest
 * by their visitor, then session. The activity's own id is the last resort so it is never empty.
 */
export function shopperAggregate(
  shopper: ShopperIdentity,
  fallbackId: string,
): { type: string; id: string } {
  return {
    type: 'shopper',
    id: shopper.userId ?? shopper.visitorId ?? shopper.sessionId ?? fallbackId,
  };
}

/** The fields an action cannot be stored without. A message missing one can never succeed. */
export function missingFields(activity: ShopperActivity): string[] {
  const need = (...fields: Array<keyof ShopperActivity>) =>
    fields.filter((field) => !activity[field]);
  switch (activity.action) {
    case 'product_viewed':
    case 'wishlist_item_added':
    case 'wishlist_item_removed':
    case 'cart_item_added':
    case 'cart_item_removed':
      return need('id', 'productId');
    case 'searched':
      return need('id', 'query');
    case 'store_viewed':
      return need('id', 'vendorId');
    case 'category_viewed':
      return need('id', 'categoryId');
    case 'shelf_item_seen':
    case 'shelf_item_clicked':
    case 'shelf_item_dismissed':
      return need('id', 'surface');
  }
}

// ── Which table an action is stored in ───────────────────────────────────────

export type ActivityStore = 'product_views' | 'searches' | 'shelf' | 'activity';

export function storeFor(action: ShopperAction): ActivityStore {
  switch (action) {
    case 'product_viewed':
      return 'product_views';
    case 'searched':
      return 'searches';
    case 'shelf_item_seen':
    case 'shelf_item_clicked':
    case 'shelf_item_dismissed':
    case 'category_viewed':
      return 'shelf';
    default:
      return 'activity';
  }
}

const ACTIVITY_TYPE = {
  store_viewed: 'STORE_VIEW',
  cart_item_added: 'CART_ADD',
  cart_item_removed: 'CART_REMOVE',
  wishlist_item_added: 'WISHLIST_ADD',
  wishlist_item_removed: 'WISHLIST_REMOVE',
} as const;

const SHELF_TYPE = {
  shelf_item_seen: 'IMPRESSION',
  shelf_item_clicked: 'CLICK',
  shelf_item_dismissed: 'DISMISS',
  category_viewed: 'CATEGORY_VIEW',
} as const;

type ActivityTypeAction = keyof typeof ACTIVITY_TYPE;
type ShelfAction = keyof typeof SHELF_TYPE;

/** The action a stored `event_type` label stands for (store/cart/wishlist rows). */
export function actionForActivityType(
  label: string,
): ShopperAction | undefined {
  return (Object.keys(ACTIVITY_TYPE) as ActivityTypeAction[]).find(
    (action) => ACTIVITY_TYPE[action] === label,
  );
}

/** The action a shelf `event_type` label stands for (IMPRESSION, CLICK, ...). */
export function actionForShelfType(label: string): ShopperAction | undefined {
  return (Object.keys(SHELF_TYPE) as ShelfAction[]).find(
    (action) => SHELF_TYPE[action] === label,
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export function toProductViewRow(
  activity: ShopperActivity,
  createdAt: Date,
): Prisma.ProductViewCreateManyInput {
  return {
    // The id is the redelivery guard: RabbitMQ may redeliver after the insert succeeded but before
    // the acknowledgement was recorded.
    id: activity.id,
    productId: activity.productId as string,
    userId: activity.userId ?? null,
    visitorId: activity.visitorId ?? null,
    sessionId: activity.sessionId ?? null,
    createdAt,
  };
}

export function toSearchRow(
  activity: ShopperActivity,
  createdAt: Date,
): Prisma.SearchQueryCreateManyInput {
  return {
    id: activity.id,
    query: activity.query as string,
    resultsCount: activity.resultsCount ?? 0,
    userId: activity.userId ?? null,
    sessionId: activity.sessionId ?? null,
    createdAt,
  };
}

export function toShelfRow(
  activity: ShopperActivity,
  createdAt: Date,
): Prisma.RecommendationEventCreateManyInput {
  return {
    id: activity.id,
    eventType: SHELF_TYPE[activity.action as ShelfAction],
    surface: activity.surface as string,
    requestId: activity.requestId ?? null,
    rankerVersion: activity.rankerVersion ?? null,
    position: activity.position ?? null,
    productId: activity.productId ?? null,
    vendorId: activity.vendorId ?? null,
    categoryId: activity.categoryId ?? null,
    userId: activity.userId ?? null,
    sessionId: activity.sessionId ?? null,
    createdAt,
  };
}

/** The row for a store view, a cart change or a wishlist change. */
export function toActivityRow(
  activity: ShopperActivity,
  createdAt: Date,
): Prisma.MarketplaceEventCreateManyInput {
  const isWishlist =
    activity.action === 'wishlist_item_added' ||
    activity.action === 'wishlist_item_removed';
  return {
    id: activity.id,
    eventType: ACTIVITY_TYPE[activity.action as ActivityTypeAction],
    vendorId: activity.vendorId ?? null,
    productId: activity.productId ?? null,
    variantId: activity.variantId ?? null,
    categoryId: activity.categoryId ?? null,
    userId: activity.userId ?? null,
    visitorId: activity.visitorId ?? null,
    sessionId: activity.sessionId ?? null,
    cartId: activity.cartId ?? null,
    // A wishlist change is one item; the column has always held 1 for it.
    quantity: isWishlist ? 1 : (activity.quantity ?? null),
    surface: activity.surface ?? null,
    createdAt,
  };
}

/** A stored row of any of the shapes above, read back as an activity body (previous-release messages). */
export function bodyFromRow(
  row: Partial<Record<keyof ShopperActivityBody, unknown>>,
  fallbackId: string,
): ShopperActivityBody {
  const text = (value: unknown) =>
    typeof value === 'string' && value ? value : null;
  const num = (value: unknown) => (typeof value === 'number' ? value : null);
  return {
    id: text(row.id) ?? fallbackId,
    userId: text(row.userId),
    visitorId: text(row.visitorId),
    sessionId: text(row.sessionId),
    surface: text(row.surface),
    productId: text(row.productId),
    vendorId: text(row.vendorId),
    variantId: text(row.variantId),
    categoryId: text(row.categoryId),
    cartId: text(row.cartId),
    quantity: num(row.quantity),
    requestId: text(row.requestId),
    rankerVersion: text(row.rankerVersion),
    position: num(row.position),
  };
}

// ── Which actions change what to recommend ───────────────────────────────────

/** A search, a click, a dismissal and a category view change what to recommend; a view of a shelf item does not. */
const CHANGES_RECOMMENDATIONS: ReadonlySet<ShopperAction> = new Set([
  'searched',
  'shelf_item_clicked',
  'shelf_item_dismissed',
  'category_viewed',
]);

/**
 * Whose cached recommendations to clear once the activity is stored, and whose feed the worker can
 * rebuild ahead of their next read. Worked out from who did it, not carried in the message. Only a
 * signed-in shopper's feed is rebuilt: a guest's feed is keyed by a visitor id some activity does not
 * carry, so a rebuild could land under the wrong key.
 */
export function feedRefreshFor(
  activity: ShopperActivity,
): { keys: string[]; actor?: FeedActor } | null {
  if (!CHANGES_RECOMMENDATIONS.has(activity.action)) return null;
  const keys = [activity.userId, activity.sessionId, activity.visitorId].filter(
    (key): key is string => Boolean(key),
  );
  if (keys.length === 0) return null;
  return {
    keys,
    ...(activity.userId
      ? {
          actor: {
            userId: activity.userId,
            sessionId: activity.sessionId ?? undefined,
            visitorId: activity.visitorId ?? undefined,
          },
        }
      : {}),
  };
}
