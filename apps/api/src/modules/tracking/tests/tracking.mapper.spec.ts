import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import { SHOPPER_ACTIONS, type ShopperActivity } from '../types/tracking.types';
import {
  SHOPPER_ACTIVITY_EVENTS,
  actionForActivityType,
  actionForEvent,
  actionForShelfType,
  bodyFromRow,
  eventNameFor,
  feedRefreshFor,
  missingFields,
  shopperAggregate,
  storeFor,
  toActivityRow,
  toProductViewRow,
  toSearchRow,
  toShelfRow,
} from '../utils/tracking.mapper';

const at = new Date('2026-11-28T10:00:00.000Z');
const act = (over: Partial<ShopperActivity>): ShopperActivity => ({
  id: 'a1',
  action: 'product_viewed',
  ...over,
});

describe('the shopper actions and their events', () => {
  it('every action has one event, named shopper.<action>, in the event catalog', () => {
    const catalog = new Set<string>(Object.values(DomainEvents));

    for (const action of SHOPPER_ACTIONS) {
      expect(eventNameFor(action)).toBe(`shopper.${action}`);
      expect(catalog.has(eventNameFor(action))).toBe(true);
      expect(actionForEvent(eventNameFor(action))).toBe(action);
    }
    expect(SHOPPER_ACTIVITY_EVENTS).toHaveLength(SHOPPER_ACTIONS.length);
  });

  it('every shopper.* event in the catalog is an action', () => {
    const shopperEvents = Object.values(DomainEvents).filter((name) =>
      name.startsWith('shopper.'),
    );

    expect([...shopperEvents].sort()).toEqual(
      [...SHOPPER_ACTIVITY_EVENTS].sort(),
    );
  });

  it('tells shopper activity apart from every other event', () => {
    expect(actionForEvent('order.shipped')).toBeUndefined();
    expect(actionForEvent('shopper.nothing')).toBeUndefined();
  });
});

describe('shopperAggregate', () => {
  it('is about the shopper: user first, then visitor, then session, then the activity itself', () => {
    expect(shopperAggregate({ userId: 'u1', visitorId: 'x' }, 'a')).toEqual({
      type: 'shopper',
      id: 'u1',
    });
    expect(shopperAggregate({ visitorId: 'vis', sessionId: 's' }, 'a').id).toBe(
      'vis',
    );
    expect(shopperAggregate({ sessionId: 's' }, 'a').id).toBe('s');
    expect(shopperAggregate({ userId: null }, 'a').id).toBe('a');
  });
});

describe('missingFields: what each action cannot be stored without', () => {
  it.each([
    [act({ action: 'product_viewed' }), ['productId']],
    [act({ action: 'cart_item_added' }), ['productId']],
    [act({ action: 'wishlist_item_removed' }), ['productId']],
    [act({ action: 'searched' }), ['query']],
    [act({ action: 'store_viewed' }), ['vendorId']],
    [act({ action: 'category_viewed' }), ['categoryId']],
    [act({ action: 'shelf_item_clicked' }), ['surface']],
    [act({ action: 'product_viewed', id: '', productId: 'p' }), ['id']],
    [act({ action: 'product_viewed', productId: 'p' }), []],
    [act({ action: 'searched', query: 'x' }), []],
  ])('%j needs %j', (activity, missing) => {
    expect(missingFields(activity)).toEqual(missing);
  });
});

describe('which table an action is stored in', () => {
  it.each([
    ['product_viewed', 'product_views'],
    ['searched', 'searches'],
    ['shelf_item_seen', 'shelf'],
    ['shelf_item_clicked', 'shelf'],
    ['shelf_item_dismissed', 'shelf'],
    ['category_viewed', 'shelf'],
    ['store_viewed', 'activity'],
    ['cart_item_added', 'activity'],
    ['cart_item_removed', 'activity'],
    ['wishlist_item_added', 'activity'],
    ['wishlist_item_removed', 'activity'],
  ] as const)('%s → %s', (action, store) => {
    expect(storeFor(action)).toBe(store);
  });
});

describe('rows', () => {
  const who = { userId: 'u1', visitorId: 'vis', sessionId: 's1' };

  it('a product view keeps its id, shopper and time', () => {
    expect(toProductViewRow(act({ ...who, productId: 'p1' }), at)).toEqual({
      id: 'a1',
      productId: 'p1',
      userId: 'u1',
      visitorId: 'vis',
      sessionId: 's1',
      createdAt: at,
    });
  });

  it('a search defaults to no results and drops the visitor (the table has no column for it)', () => {
    expect(
      toSearchRow(act({ ...who, action: 'searched', query: 'q' }), at),
    ).toEqual({
      id: 'a1',
      query: 'q',
      resultsCount: 0,
      userId: 'u1',
      sessionId: 's1',
      createdAt: at,
    });
  });

  it.each([
    ['shelf_item_seen', 'IMPRESSION'],
    ['shelf_item_clicked', 'CLICK'],
    ['shelf_item_dismissed', 'DISMISS'],
    ['category_viewed', 'CATEGORY_VIEW'],
  ] as const)('%s is stored as %s', (action, label) => {
    const row = toShelfRow(
      act({ ...who, action, surface: 'HOME_FOR_YOU', position: 3 }),
      at,
    );
    expect(row).toMatchObject({
      eventType: label,
      surface: 'HOME_FOR_YOU',
      position: 3,
      userId: 'u1',
      sessionId: 's1',
    });
    expect(actionForShelfType(label)).toBe(action);
  });

  it.each([
    ['store_viewed', 'STORE_VIEW'],
    ['cart_item_added', 'CART_ADD'],
    ['cart_item_removed', 'CART_REMOVE'],
    ['wishlist_item_added', 'WISHLIST_ADD'],
    ['wishlist_item_removed', 'WISHLIST_REMOVE'],
  ] as const)('%s is stored as %s, and read back as %s', (action, label) => {
    expect(toActivityRow(act({ action }), at).eventType).toBe(label);
    expect(actionForActivityType(label)).toBe(action);
  });

  it('a cart change keeps the units and the cart; a wishlist change is always one item', () => {
    expect(
      toActivityRow(
        act({
          action: 'cart_item_added',
          productId: 'p',
          cartId: 'c',
          quantity: 3,
        }),
        at,
      ),
    ).toMatchObject({ cartId: 'c', quantity: 3 });
    expect(
      toActivityRow(
        act({ action: 'wishlist_item_added', productId: 'p', quantity: 9 }),
        at,
      ),
    ).toMatchObject({ quantity: 1 });
  });

  it('leaves every unknown field empty rather than undefined', () => {
    const row = toActivityRow(
      act({ action: 'store_viewed', vendorId: 'v' }),
      at,
    );
    expect(row).toMatchObject({
      productId: null,
      userId: null,
      visitorId: null,
      cartId: null,
      quantity: null,
      surface: null,
    });
  });

  it('unknown labels are not an action', () => {
    expect(actionForActivityType('SOMETHING')).toBeUndefined();
    expect(actionForShelfType('SOMETHING')).toBeUndefined();
  });
});

describe('bodyFromRow (previous-release messages)', () => {
  it('keeps what is a string or number and nulls the rest', () => {
    expect(
      bodyFromRow({ id: 'x', userId: 'u', quantity: 2, position: 'no' }, 'fb'),
    ).toMatchObject({ id: 'x', userId: 'u', quantity: 2, position: null });
    expect(bodyFromRow({}, 'fb').id).toBe('fb');
  });
});

describe('feedRefreshFor: which activity changes what to recommend', () => {
  const who = { userId: 'u1', visitorId: 'vis', sessionId: 's1' };

  it.each([
    'searched',
    'shelf_item_clicked',
    'shelf_item_dismissed',
    'category_viewed',
  ] as const)(
    '%s refreshes the signed-in shopper’s shelves and feed',
    (action) => {
      expect(feedRefreshFor(act({ ...who, action }))).toEqual({
        keys: ['u1', 's1', 'vis'],
        actor: { userId: 'u1', sessionId: 's1', visitorId: 'vis' },
      });
    },
  );

  it.each([
    'product_viewed',
    'shelf_item_seen',
    'store_viewed',
    'cart_item_added',
    'wishlist_item_added',
  ] as const)('%s refreshes nothing', (action) => {
    expect(feedRefreshFor(act({ ...who, action }))).toBeNull();
  });

  it('clears a guest’s cached shelves but never rebuilds their feed', () => {
    expect(
      feedRefreshFor(
        act({ action: 'searched', sessionId: 's1', visitorId: 'v' }),
      ),
    ).toEqual({ keys: ['s1', 'v'] });
  });

  it('has nothing to refresh for an activity with no shopper at all', () => {
    expect(feedRefreshFor(act({ action: 'searched' }))).toBeNull();
  });
});
