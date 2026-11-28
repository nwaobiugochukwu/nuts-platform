import { ROLE } from '@prisma/client';
import { TrackingService } from '../services/tracking.service';

describe('TrackingService', () => {
  let prisma: { vendor: { findFirst: jest.Mock } };
  let recorder: { record: jest.Mock };
  let service: TrackingService;

  beforeEach(() => {
    prisma = {
      vendor: { findFirst: jest.fn().mockResolvedValue({ id: 'v1' }) },
    };
    recorder = { record: jest.fn().mockResolvedValue(undefined) };
    service = new TrackingService(prisma as never, recorder as never);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  const cart = {
    productId: 'p1',
    vendorId: 'v1',
    userId: 'u1',
    cartId: 'c1',
    quantity: 2,
    surface: 'CART',
  };
  const wish = {
    productId: 'p1',
    vendorId: 'v1',
    userId: 'u1',
    surface: 'WISHLIST',
  };

  describe('each kind of activity is its own event', () => {
    it.each([
      ['cartItemAdded', cart, 'cart_item_added'],
      ['cartItemRemoved', cart, 'cart_item_removed'],
      ['wishlistItemAdded', wish, 'wishlist_item_added'],
      ['wishlistItemRemoved', wish, 'wishlist_item_removed'],
    ] as const)('%s records a %s activity', async (method, change, action) => {
      await expect((service as any)[method](change)).resolves.toEqual({
        accepted: true,
      });

      expect(recorder.record).toHaveBeenCalledWith({
        ...change,
        id: expect.any(String),
        action,
      });
    });

    it('keeps an id the caller chose and makes one otherwise', async () => {
      await service.cartItemAdded({ ...cart, id: 'evt-9' });
      await service.cartItemAdded(cart);

      expect(recorder.record.mock.calls[0][0].id).toBe('evt-9');
      expect(recorder.record.mock.calls[1][0].id).not.toBe('evt-9');
    });
  });

  it('never fails the purchase or the wishlist change: an unexpected error is reported as not accepted', async () => {
    recorder.record.mockRejectedValue(new Error('boom'));

    await expect(service.cartItemAdded(cart)).resolves.toEqual({
      accepted: false,
    });
    await expect(service.wishlistItemAdded(wish)).resolves.toEqual({
      accepted: false,
    });
  });

  describe('storeViewed', () => {
    const identity = { id: 'view-1', visitorId: 'vis', sessionId: 's1' };

    it('records a store_viewed activity about the vendor, from the store page', async () => {
      await expect(
        service.storeViewed('v1', identity, 'u1', ROLE.USER),
      ).resolves.toEqual({ accepted: true });

      expect(recorder.record).toHaveBeenCalledWith({
        action: 'store_viewed',
        id: 'view-1',
        vendorId: 'v1',
        userId: 'u1',
        visitorId: 'vis',
        sessionId: 's1',
        surface: 'VENDOR_STORE',
      });
    });

    it('counts a guest by their visitor and session', async () => {
      await service.storeViewed('v1', identity);

      expect(recorder.record.mock.calls[0][0]).toMatchObject({
        userId: null,
        visitorId: 'vis',
        sessionId: 's1',
      });
    });

    it('counts a vendor browsing another store as an anonymous visitor, never as a customer', async () => {
      await service.storeViewed(
        'v1',
        { id: 'view-2' },
        'vendor-9',
        ROLE.VENDOR,
      );

      expect(recorder.record.mock.calls[0][0]).toMatchObject({
        userId: null,
        visitorId: 'vendor:vendor-9',
      });
    });

    it.each([
      ['staff', ['v1', identity, 'a1', ROLE.ADMIN]],
      ['a vendor viewing their own store', ['v1', identity, 'v1', ROLE.VENDOR]],
    ] as const)(
      'does not count %s, and says so as accepted',
      async (_label, args) => {
        await expect((service.storeViewed as any)(...args)).resolves.toEqual({
          accepted: true,
        });

        expect(recorder.record).not.toHaveBeenCalled();
        expect(prisma.vendor.findFirst).not.toHaveBeenCalled();
      },
    );

    it('refuses a store that does not exist or is not live', async () => {
      prisma.vendor.findFirst.mockResolvedValue(null);

      await expect(service.storeViewed('gone', identity)).resolves.toEqual({
        accepted: false,
      });
      expect(recorder.record).not.toHaveBeenCalled();
    });
  });
});
