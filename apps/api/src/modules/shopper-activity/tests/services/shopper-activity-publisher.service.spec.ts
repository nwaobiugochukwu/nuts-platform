import { ShopperActivityPublisherService } from '../../services/shopper-activity-publisher.service';

describe('ShopperActivityPublisherService', () => {
  let rabbit: { isAvailable: jest.Mock; publish: jest.Mock };
  let publisher: ShopperActivityPublisherService;

  beforeEach(() => {
    rabbit = {
      isAvailable: jest.fn().mockReturnValue(true),
      publish: jest.fn().mockResolvedValue(true),
    };
    publisher = new ShopperActivityPublisherService(rabbit as never);
  });

  it('publishes the activity as shopper.<action> in the standard envelope, about the shopper', async () => {
    const at = new Date('2026-11-28T10:00:00.000Z');

    await expect(
      publisher.record(
        { action: 'searched', id: 's1', query: 'shoes', userId: 'u1' },
        { occurredAt: at },
      ),
    ).resolves.toBe(true);

    const [key, envelope, options] = rabbit.publish.mock.calls[0];
    expect(key).toBe('shopper.searched');
    expect(envelope).toMatchObject({
      type: 'shopper.searched',
      version: 1,
      occurredAt: at.toISOString(),
      aggregate: { type: 'shopper', id: 'u1' },
      actor: { type: 'user', id: 'u1' },
      payload: { id: 's1', query: 'shoes', userId: 'u1' },
    });
    // The action is the routing key, so it is not repeated in the body.
    expect(envelope.payload).not.toHaveProperty('action');
    expect(options.messageId).toBe(envelope.eventId);
  });

  it('names a guest by visitor, then session, and records them as a system actor, not a user', async () => {
    await publisher.record({
      action: 'product_viewed',
      id: 'v1',
      productId: 'p1',
      visitorId: 'vis',
      sessionId: 's',
    });

    const envelope = rabbit.publish.mock.calls[0][1];
    expect(envelope.aggregate).toEqual({ type: 'shopper', id: 'vis' });
    expect(envelope.actor).toEqual({ type: 'system' });
  });

  it('reports false, publishing nothing, when the broker is unavailable or not configured', async () => {
    rabbit.isAvailable.mockReturnValue(false);
    await expect(
      publisher.record({ action: 'store_viewed', id: 'x', vendorId: 'v' }),
    ).resolves.toBe(false);
    expect(rabbit.publish).not.toHaveBeenCalled();

    await expect(
      new ShopperActivityPublisherService().record({
        action: 'store_viewed',
        id: 'x',
        vendorId: 'v',
      }),
    ).resolves.toBe(false);
  });

  it('reports the broker’s answer', async () => {
    rabbit.publish.mockResolvedValue(false);

    await expect(
      publisher.record({ action: 'store_viewed', id: 'x', vendorId: 'v' }),
    ).resolves.toBe(false);
  });
});
