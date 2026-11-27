import { PermanentConsumerError } from '../rabbitmq/consumer-retry.util';
import {
  buildEnvelope,
  isEventEnvelope,
  isValidEventType,
  parseEnvelope,
} from './event-envelope.util';

const input = {
  type: 'order.shipped',
  aggregate: { type: 'order', id: 'o-1' },
  payload: { orderId: 'o-1' },
};

describe('event type naming', () => {
  it.each([
    'order.shipped',
    'user.login_from_new_device',
    'referral.reward_credited',
    'product.low_stock_detected',
  ])('accepts %s', (type) => expect(isValidEventType(type)).toBe(true));

  it.each([
    'order',
    'Order.shipped',
    'order.Shipped',
    'order.shipped.now',
    'order.reward.credited',
    'order.',
    '.shipped',
    'order shipped',
    'order.ship-ped',
  ])('rejects %s', (type) => expect(isValidEventType(type)).toBe(false));
});

describe('buildEnvelope', () => {
  it('fills version 1, a system actor and the time of the fact', () => {
    const at = new Date('2026-11-28T10:00:00.000Z');
    const envelope = buildEnvelope(
      { ...input, occurredAt: at },
      { eventId: 'e-1' },
    );

    expect(envelope).toEqual({
      eventId: 'e-1',
      type: 'order.shipped',
      version: 1,
      occurredAt: '2026-11-28T10:00:00.000Z',
      aggregate: { type: 'order', id: 'o-1' },
      actor: { type: 'system' },
      payload: { orderId: 'o-1' },
    });
  });

  it('carries the request id and the actor when there are some', () => {
    const envelope = buildEnvelope(
      { ...input, version: 2, actor: { type: 'admin', id: 'a-1' } },
      { eventId: 'e-1', requestId: 'req-9' },
    );

    expect(envelope).toMatchObject({
      version: 2,
      actor: { type: 'admin', id: 'a-1' },
      requestId: 'req-9',
    });
  });

  it('refuses a type that breaks the naming rule', () => {
    expect(() =>
      buildEnvelope({ ...input, type: 'OrderShipped' }, { eventId: 'e' }),
    ).toThrow(/<aggregate>\.<fact>/);
  });
});

describe('parseEnvelope', () => {
  const valid = buildEnvelope(input, { eventId: 'e-1' });

  it('returns a valid envelope', () => {
    expect(parseEnvelope(valid)).toEqual(valid);
    expect(isEventEnvelope(valid)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a flat old-style payload', { orderId: 'o-1', eventId: 'e' }],
    ['a missing payload', { ...valid, payload: undefined }],
  ])('rejects %s as a permanent failure', (_label, raw) => {
    expect(() => parseEnvelope(raw)).toThrow(PermanentConsumerError);
  });

  it('can insist on an event type and on a payload version the consumer can read', () => {
    expect(() => parseEnvelope(valid, { type: 'order.delivered' })).toThrow(
      PermanentConsumerError,
    );
    expect(
      parseEnvelope(valid, { type: ['order.shipped', 'order.delivered'] }),
    ).toEqual(valid);
    expect(() =>
      parseEnvelope({ ...valid, version: 3 }, { supportedVersions: [1, 2] }),
    ).toThrow(/Unsupported version 3/);
  });
});
