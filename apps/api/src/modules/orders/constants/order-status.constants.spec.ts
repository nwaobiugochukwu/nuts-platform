import {
  MULTI_VENDOR_STATUS_MESSAGE,
  vendorMayChangeOrderStatus,
} from './order-status.constants';

describe('vendorMayChangeOrderStatus', () => {
  it('allows a vendor that is the only vendor on the order', () => {
    expect(vendorMayChangeOrderStatus(['v1'])).toBe(true);
    expect(vendorMayChangeOrderStatus(['v1', 'v1', 'v1'])).toBe(true);
  });

  it('blocks a vendor when another vendor also has items on the order', () => {
    expect(vendorMayChangeOrderStatus(['v1', 'v2'])).toBe(false);
    expect(vendorMayChangeOrderStatus(['v1', 'v1', 'v2'])).toBe(false);
  });

  it('explains that the platform manages multi-vendor orders', () => {
    expect(MULTI_VENDOR_STATUS_MESSAGE).toMatch(/more than one vendor/);
  });
});
