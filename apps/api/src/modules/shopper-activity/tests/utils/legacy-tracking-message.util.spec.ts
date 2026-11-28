import { isEventEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { buildEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { adaptLegacyTrackingMessage } from '../../utils/legacy-tracking-message.util';

const stamp = '2026-11-28T10:00:00.000Z';

describe('adaptLegacyTrackingMessage', () => {
  it('turns an old product_view into shopper.product_viewed, keeping its id and its time', () => {
    const [event] = adaptLegacyTrackingMessage({
      type: 'product_view',
      id: 'v1',
      productId: 'p1',
      userId: 'u1',
      timestamp: stamp,
    }) as ReturnType<typeof buildEnvelope>[];

    expect(isEventEnvelope(event)).toBe(true);
    expect(event).toMatchObject({
      type: 'shopper.product_viewed',
      occurredAt: stamp,
      aggregate: { type: 'shopper', id: 'u1' },
      payload: { id: 'v1', productId: 'p1', userId: 'u1' },
    });
  });

  it('gives an old view with no id the same stable id each time', () => {
    const old = {
      type: 'product_view',
      productId: 'p1',
      userId: 'u1',
      timestamp: stamp,
    };
    const first = (adaptLegacyTrackingMessage(old) as any[])[0].payload.id;
    const second = (adaptLegacyTrackingMessage(old) as any[])[0].payload.id;

    expect(first).toEqual(second);
  });

  it('turns an old search into shopper.searched', () => {
    const [event] = adaptLegacyTrackingMessage({
      type: 'search',
      id: 's1',
      query: 'shoes',
      resultsCount: 2,
      sessionId: 'sess',
    }) as any[];

    expect(event).toMatchObject({
      type: 'shopper.searched',
      aggregate: { type: 'shopper', id: 'sess' },
      payload: { id: 's1', query: 'shoes', resultsCount: 2 },
    });
  });

  it('turns an old recommendation batch into one event per interaction', () => {
    const events = adaptLegacyTrackingMessage({
      type: 'recommendation_events',
      events: [
        { id: 'r1', eventType: 'CLICK', surface: 'HOME_FOR_YOU', userId: 'u1' },
        { id: 'r2', eventType: 'IMPRESSION', surface: 'HOME_FOR_YOU' },
        { id: 'r3', eventType: 'WHAT', surface: 'HOME_FOR_YOU' },
      ],
    }) as any[];

    expect(events.map((e) => e.type)).toEqual([
      'shopper.shelf_item_clicked',
      'shopper.shelf_item_seen',
    ]);
    expect(events[0].payload).toMatchObject({ id: 'r1', userId: 'u1' });
  });

  it.each([
    ['STORE_VIEW', 'shopper.store_viewed'],
    ['CART_ADD', 'shopper.cart_item_added'],
    ['CART_REMOVE', 'shopper.cart_item_removed'],
    ['WISHLIST_ADD', 'shopper.wishlist_item_added'],
    ['WISHLIST_REMOVE', 'shopper.wishlist_item_removed'],
  ])('turns an old marketplace %s into %s', (eventType, name) => {
    const [event] = adaptLegacyTrackingMessage({
      type: 'marketplace_event',
      event: { id: 'm1', eventType, productId: 'p1', vendorId: 'v1' },
    }) as any[];

    expect(event.type).toBe(name);
    expect(event.payload.id).toBe('m1');
  });

  it.each([
    ['nothing', undefined],
    ['a view with no product', { type: 'product_view' }],
    ['a search with no text', { type: 'search' }],
    [
      'a batch of unknown interactions',
      { type: 'recommendation_events', events: [{ eventType: 'X' }] },
    ],
    [
      'a marketplace event of an unknown kind',
      { type: 'marketplace_event', event: { eventType: 'X' } },
    ],
    ['an unknown old type', { type: 'something' }],
  ])('ignores %s', (_label, raw) => {
    expect(adaptLegacyTrackingMessage(raw)).toBe('ignore');
  });

  it('leaves a message that is not in the old shape for the normal path', () => {
    expect(adaptLegacyTrackingMessage('text')).toBeNull();
    expect(adaptLegacyTrackingMessage({ no: 'type' })).toBeNull();
    expect(
      adaptLegacyTrackingMessage(
        buildEnvelope(
          {
            type: 'shopper.searched',
            aggregate: { type: 'shopper', id: '1' },
            payload: {},
          },
          { eventId: 'e' },
        ),
      ),
    ).toBeNull();
  });
});
