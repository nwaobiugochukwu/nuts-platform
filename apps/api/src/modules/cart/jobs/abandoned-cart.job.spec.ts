import { NotificationType, ROLE } from '@prisma/client';
import { ABANDONED_CART } from '@api/common/constants';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { AbandonedCartJob } from './abandoned-cart.job';

const HOUR = 60 * 60 * 1000;

describe('AbandonedCartJob', () => {
  let prisma: { cart: { findMany: jest.Mock; update: jest.Mock } };
  let rabbitmq: { publish: jest.Mock };
  let templates: { abandonedCartReminder: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };
  let cron: AbandonedCartJob;

  const cart = (overrides: Record<string, unknown> = {}) => ({
    id: 'cart-1',
    userId: 'user-1',
    user: { id: 'user-1', email: 'a@b.com', firstName: 'Ada' },
    cartItems: [
      { quantity: 2, totalPrice: '1500.50' },
      { quantity: 1, totalPrice: '499.50' },
    ],
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-27T12:00:00.000Z'));
    prisma = {
      cart: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    rabbitmq = { publish: jest.fn().mockResolvedValue(true) };
    templates = {
      abandonedCartReminder: jest.fn().mockReturnValue('<html>reminder</html>'),
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    cron = new AbandonedCartJob(
      prisma as never,
      rabbitmq as never,
      templates as never,
      redis as never,
    );
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest
        .spyOn((cron as any).logger, level)
        .mockImplementation(() => undefined);
    }
  });

  afterEach(() => jest.useRealTimers());

  it('looks for unchecked carts with items that went quiet between 2 hours and 7 days ago', async () => {
    prisma.cart.findMany.mockResolvedValue([]);

    await cron.handleAbandonedCarts();

    const args = prisma.cart.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      checkedOut: false,
      abandonedCartAlerted: false,
      updatedAt: {
        lte: new Date(Date.now() - ABANDONED_CART.FIRST_REMINDER_HOURS * HOUR),
        gte: new Date(Date.now() - 7 * 24 * HOUR),
      },
      cartItems: { some: {} },
    });
    expect(args.take).toBe(500);
    expect(rabbitmq.publish).not.toHaveBeenCalled();
  });

  it('queues the reminder email and the in-app notification, then remembers it for 72 hours', async () => {
    prisma.cart.findMany.mockResolvedValue([cart()]);

    await cron.handleAbandonedCarts();

    expect(templates.abandonedCartReminder).toHaveBeenCalledWith({
      firstName: 'Ada',
      itemCount: 3,
      totalAmount: 2000,
      currency: 'NGN',
      reminderType: 'first',
    });
    expect(rabbitmq.publish).toHaveBeenCalledWith(RABBITMQ_QUEUES.EMAILS, {
      to: 'a@b.com',
      subject: 'You left something in your cart!',
      html: '<html>reminder</html>',
      type: 'abandoned_cart',
      metadata: { cartId: 'cart-1', userId: 'user-1' },
    });
    expect(rabbitmq.publish).toHaveBeenCalledWith(
      RABBITMQ_QUEUES.NOTIFICATIONS,
      expect.objectContaining({
        userId: 'user-1',
        role: ROLE.USER,
        type: NotificationType.SYSTEM_ANNOUNCEMENT,
        link: '/cart',
      }),
    );
    expect(prisma.cart.update).toHaveBeenCalledWith({
      where: { id: 'cart-1' },
      data: { abandonedCartAlerted: true },
    });
    expect(redis.set).toHaveBeenCalledWith(
      'cart:reminder:cart-1:first',
      'sent',
      'EX',
      72 * 3600,
    );
  });

  it('does not send a second reminder for a cart already reminded, and flags it', async () => {
    prisma.cart.findMany.mockResolvedValue([cart()]);
    redis.get.mockResolvedValue('sent');

    await cron.handleAbandonedCarts();

    expect(rabbitmq.publish).not.toHaveBeenCalled();
    expect(prisma.cart.update).toHaveBeenCalledWith({
      where: { id: 'cart-1' },
      data: { abandonedCartAlerted: true },
    });
  });

  it('handles several carts independently', async () => {
    prisma.cart.findMany.mockResolvedValue([
      cart({ id: 'c1' }),
      cart({ id: 'c2' }),
    ]);
    redis.get.mockResolvedValueOnce('sent').mockResolvedValueOnce(null);

    await cron.handleAbandonedCarts();

    const emails = rabbitmq.publish.mock.calls.filter(
      (c) => c[0] === RABBITMQ_QUEUES.EMAILS,
    );
    expect(emails).toHaveLength(1);
    expect(emails[0][1].metadata.cartId).toBe('c2');
  });

  it('idles quietly when the carts table does not exist yet', async () => {
    prisma.cart.findMany.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'P2021' }),
    );

    await expect(cron.handleAbandonedCarts()).resolves.toBeUndefined();
    expect((cron as any).logger.warn).toHaveBeenCalled();
    expect((cron as any).logger.error).not.toHaveBeenCalled();
  });

  it('logs any other failure and does not throw', async () => {
    prisma.cart.findMany.mockRejectedValue(new Error('db down'));

    await expect(cron.handleAbandonedCarts()).resolves.toBeUndefined();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'db down' }),
      'Abandoned cart cron failed',
    );
  });

  // KNOWN DEFECT (audit R6/E-list): publish() returns false when the broker is unavailable,
  // but the cron ignores it, flags the cart as reminded and remembers it for 72 hours, so the
  // reminder is lost for good. Marked `failing` until it is fixed.
  it.failing(
    'does not flag the cart as reminded when the email could not be queued',
    async () => {
      prisma.cart.findMany.mockResolvedValue([cart()]);
      rabbitmq.publish.mockResolvedValue(false);

      await cron.handleAbandonedCarts();

      expect(prisma.cart.update).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    },
  );
});
