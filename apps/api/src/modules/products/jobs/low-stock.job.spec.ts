import { NotificationType, ROLE } from '@prisma/client';
import { LOW_STOCK } from '@api/common/constants';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { LowStockJob } from './low-stock.job';

describe('LowStockJob', () => {
  let prisma: {
    product: { findMany: jest.Mock };
    productVariant: { findMany: jest.Mock };
  };
  let rabbitmq: { publish: jest.Mock };
  let templates: { lowStockAlert: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };
  let notifications: { create: jest.Mock };
  let preferences: { canSend: jest.Mock };
  let cron: LowStockJob;

  const vendor = { id: 'vendor-1', email: 'v@shop.com', storeName: 'Shop' };
  const product = (overrides: Record<string, unknown> = {}) => ({
    id: 'p1',
    name: 'Red Shoe',
    stock: 3,
    vendor,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      product: { findMany: jest.fn().mockResolvedValue([]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    };
    rabbitmq = { publish: jest.fn().mockResolvedValue(true) };
    templates = {
      lowStockAlert: jest.fn().mockReturnValue('<html>low</html>'),
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
    preferences = { canSend: jest.fn().mockResolvedValue(true) };
    cron = new LowStockJob(
      prisma as never,
      rabbitmq as never,
      templates as never,
      redis as never,
      notifications as never,
      preferences as never,
    );
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest
        .spyOn((cron as any).logger, level)
        .mockImplementation(() => undefined);
    }
  });

  it('looks for active, undeleted stock between 1 and the threshold, for products and variants', async () => {
    await cron.handleLowStock();

    expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      isDeleted: false,
      hasVariants: false,
      stock: { gt: 0, lt: LOW_STOCK.THRESHOLD },
    });
    expect(prisma.productVariant.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      isDeleted: false,
      stock: { gt: 0, lt: LOW_STOCK.THRESHOLD },
      product: { isDeleted: false, isActive: true, hasVariants: true },
    });
    expect(rabbitmq.publish).not.toHaveBeenCalled();
  });

  it('alerts the vendor in the app and by email, then remembers it for the duplicate window', async () => {
    prisma.product.findMany.mockResolvedValue([product()]);

    await cron.handleLowStock();

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'vendor-1',
        role: ROLE.VENDOR,
        type: NotificationType.LOW_STOCK_ALERT,
        message: 'Red Shoe is running low (3 remaining).',
        dedupeKey: 'lowstock:inapp:low-stock-product:p1',
      }),
    );
    expect(rabbitmq.publish).toHaveBeenCalledWith(RABBITMQ_QUEUES.EMAILS, {
      to: 'v@shop.com',
      subject: 'Low Stock Alert - Red Shoe',
      html: '<html>low</html>',
      type: 'low_stock_alert',
      metadata: {
        productName: 'Red Shoe',
        currentStock: 3,
        variantName: undefined,
      },
    });
    expect(redis.set).toHaveBeenCalledWith(
      'lowstock:low-stock-product:p1',
      'sent',
      'EX',
      LOW_STOCK.DUPLICATE_WINDOW_HOURS * 3600,
    );
  });

  it('names the variant from its options (list or object form)', async () => {
    prisma.productVariant.findMany.mockResolvedValue([
      {
        id: 'v1',
        stock: 2,
        options: [
          { name: 'Size', value: '42' },
          { name: 'Colour', value: 'Red' },
        ],
        product: { id: 'p2', name: 'Boot', vendor },
      },
      {
        id: 'v2',
        stock: 1,
        options: { size: '43', colour: 'Blue' },
        product: { id: 'p2', name: 'Boot', vendor },
      },
    ]);

    await cron.handleLowStock();

    const messages = notifications.create.mock.calls.map((c) => c[0].message);
    expect(messages).toEqual([
      'Boot (42, Red) is running low (2 remaining).',
      'Boot (43, Blue) is running low (1 remaining).',
    ]);
    expect(notifications.create.mock.calls[0][0].dedupeKey).toBe(
      'lowstock:inapp:low-stock-variant:v1',
    );
  });

  it('does not alert twice inside the duplicate window', async () => {
    prisma.product.findMany.mockResolvedValue([product()]);
    redis.get.mockResolvedValue('sent');

    await cron.handleLowStock();

    expect(notifications.create).not.toHaveBeenCalled();
    expect(rabbitmq.publish).not.toHaveBeenCalled();
  });

  it('respects a vendor who turned inventory emails off, but still notifies them in the app', async () => {
    prisma.product.findMany.mockResolvedValue([product()]);
    preferences.canSend.mockResolvedValue(false);

    await cron.handleLowStock();

    expect(preferences.canSend).toHaveBeenCalledWith(
      'vendor-1',
      ROLE.VENDOR,
      'email',
      'inventoryAlerts',
    );
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(rabbitmq.publish).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalled();
  });

  it('still sends the email when the in-app notification fails', async () => {
    prisma.product.findMany.mockResolvedValue([product()]);
    notifications.create.mockRejectedValue(new Error('db down'));

    await cron.handleLowStock();

    expect(rabbitmq.publish).toHaveBeenCalledWith(
      RABBITMQ_QUEUES.EMAILS,
      expect.any(Object),
    );
    expect((cron as any).logger.warn).toHaveBeenCalled();
  });

  it('logs and rethrows a failure so the scheduler records the run as failed', async () => {
    prisma.product.findMany.mockRejectedValue(new Error('db down'));

    await expect(cron.handleLowStock()).rejects.toThrow('db down');
    expect((cron as any).logger.error).toHaveBeenCalled();
  });
});
