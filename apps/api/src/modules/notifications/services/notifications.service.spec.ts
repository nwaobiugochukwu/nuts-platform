import { NotFoundException } from '@nestjs/common';
import { NotificationType, ROLE } from '@prisma/client';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    service = new NotificationsService(prisma as never);
  });

  it('filters notification lists by order category and current role', async () => {
    await service.list('vendor-1', ROLE.VENDOR, { category: 'orders' });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'vendor-1',
          role: ROLE.VENDOR,
          AND: [
            {
              type: {
                in: [
                  NotificationType.ORDER_PLACED,
                  NotificationType.ORDER_CONFIRMED,
                  NotificationType.ORDER_SHIPPED,
                  NotificationType.ORDER_DELIVERED,
                  NotificationType.ORDER_CANCELLED,
                ],
              },
            },
          ],
        },
      }),
    );
  });

  it('filters payment notifications and unread notifications together', async () => {
    await service.list('user-1', ROLE.USER, {
      unreadOnly: true,
      category: 'payments',
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          role: ROLE.USER,
          isRead: false,
          AND: [
            {
              type: {
                in: [
                  NotificationType.PAYMENT_RECEIVED,
                  NotificationType.PAYMENT_FAILED,
                  NotificationType.PAYMENT_REFUNDED,
                  NotificationType.PAYOUT_PROCESSED,
                ],
              },
            },
          ],
        },
      }),
    );
  });

  it('intersects an explicit notification type with the category filter', async () => {
    await service.list('user-1', ROLE.USER, {
      category: 'orders',
      type: NotificationType.PAYMENT_RECEIVED,
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          role: ROLE.USER,
          AND: [
            {
              type: {
                in: [
                  NotificationType.ORDER_PLACED,
                  NotificationType.ORDER_CONFIRMED,
                  NotificationType.ORDER_SHIPPED,
                  NotificationType.ORDER_DELIVERED,
                  NotificationType.ORDER_CANCELLED,
                ],
              },
            },
            { type: NotificationType.PAYMENT_RECEIVED },
          ],
        },
      }),
    );
  });

  it('returns detail only for a notification owned by the active role and user', async () => {
    const createdAt = new Date('2026-10-06T00:00:00.000Z');
    prisma.notification.findFirst.mockResolvedValue({
      id: 'notification-1',
      userId: 'user-1',
      role: ROLE.USER,
      link: '/account/orders',
      createdAt,
    });

    await expect(
      service.getById('notification-1', 'user-1', ROLE.USER),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'notification-1',
        actionUrl: '/account/orders',
      }),
    );
    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: { id: 'notification-1', userId: 'user-1', role: ROLE.USER },
    });
  });

  it('does not expose another user or role notification', async () => {
    prisma.notification.findFirst.mockResolvedValue(null);

    await expect(
      service.getById('notification-1', 'user-1', ROLE.ADMIN),
    ).rejects.toThrow(NotFoundException);
  });

  it('emits SSE heartbeats to keep idle notification streams open', () => {
    jest.useFakeTimers();
    const events: unknown[] = [];
    const subscription = service
      .subscribeToUserStream('user-1')
      .subscribe((event) => events.push(event));

    try {
      expect(events).toEqual([
        {
          data: {
            type: 'connected',
            timestamp: expect.any(String),
          },
        },
      ]);

      jest.advanceTimersByTime(15_000);

      expect(events).toEqual([
        {
          data: {
            type: 'connected',
            timestamp: expect.any(String),
          },
        },
        { data: { type: 'ping' } },
      ]);
    } finally {
      subscription.unsubscribe();
      jest.useRealTimers();
    }
  });

  it('returns existing notification without re-inserting when dedupeKey collides (P2002)', async () => {
    const existingNotification = {
      id: 'existing-id',
      userId: 'user-1',
      role: ROLE.USER,
      type: NotificationType.ORDER_CONFIRMED,
      title: 'Order Confirmed',
      message: 'Processing',
      dedupeKey: 'ORDER_CONFIRMED:order-123:USER:user-1',
    };

    prisma.notification.create.mockRejectedValue({ code: 'P2002' });
    prisma.notification.findUnique.mockResolvedValue(existingNotification);

    const result = await service.create({
      userId: 'user-1',
      type: NotificationType.ORDER_CONFIRMED,
      title: 'Order Confirmed',
      message: 'Processing',
      dedupeKey: 'ORDER_CONFIRMED:order-123:USER:user-1',
    });

    expect(result).toEqual(existingNotification);
    expect(prisma.notification.findUnique).toHaveBeenCalledWith({
      where: { dedupeKey: 'ORDER_CONFIRMED:order-123:USER:user-1' },
    });
  });

  describe('notification preferences', () => {
    const base = {
      userId: 'user-1',
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'New sign-in to your account',
      message: 'Your account was signed in from a new device.',
      dedupeKey: 'SECURITY:new-device:e-1',
    };
    let withPreferences: NotificationsService;
    let canSend: jest.Mock;

    beforeEach(() => {
      canSend = jest.fn().mockResolvedValue(false); // marketing is off by default
      prisma.notification.create.mockResolvedValue({
        id: 'n-1',
        ...base,
        role: ROLE.USER,
      });
      withPreferences = new NotificationsService(
        prisma as never,
        undefined,
        undefined,
        undefined,
        { canSend } as never,
      );
    });

    it('drops an ordinary notice the user has switched off', async () => {
      await expect(withPreferences.create(base)).resolves.toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('delivers an essential notice even though its category is switched off', async () => {
      const created = await withPreferences.create({
        ...base,
        essential: true,
      });

      expect(created).toMatchObject({ id: 'n-1' });
      expect(canSend).not.toHaveBeenCalled();
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    });
  });

  it('filters live notification streams by both userId and role, and attaches event id', () => {
    const events: unknown[] = [];
    const subscription = service
      .subscribeToUserStream('user-1', ROLE.USER)
      .subscribe((event) => events.push(event));

    try {
      // 1. Emit notification for user-1 with ROLE.USER -> received with event id
      (
        service as unknown as {
          broadcastNotification: (u: string, r: ROLE, n: unknown) => void;
        }
      ).broadcastNotification('user-1', ROLE.USER, {
        id: 'notif-1',
        title: 'Hello User',
      });

      // 2. Emit notification for user-1 with ROLE.ADMIN -> filtered out
      (
        service as unknown as {
          broadcastNotification: (u: string, r: ROLE, n: unknown) => void;
        }
      ).broadcastNotification('user-1', ROLE.ADMIN, {
        id: 'notif-admin',
        title: 'Hello Admin',
      });

      // 3. Emit notification for user-2 -> filtered out
      (
        service as unknown as {
          broadcastNotification: (u: string, r: ROLE, n: unknown) => void;
        }
      ).broadcastNotification('user-2', ROLE.USER, {
        id: 'notif-2',
        title: 'Other',
      });

      expect(events).toEqual([
        {
          data: {
            type: 'connected',
            timestamp: expect.any(String),
          },
        },
        {
          id: 'notif-1',
          data: { id: 'notif-1', title: 'Hello User' },
        },
      ]);
    } finally {
      subscription.unsubscribe();
    }
  });

  it('preserves existing readAt when markAsRead is called on an already-read notification', async () => {
    const existingDate = new Date('2026-10-01T12:00:00Z');
    prisma.notification.findFirst.mockResolvedValue({
      id: 'notif-1',
      userId: 'user-1',
      role: ROLE.USER,
      isRead: true,
      readAt: existingDate,
      link: '/account/orders',
    });

    const result = await service.markAsRead('notif-1', 'user-1', ROLE.USER);

    expect(result.readAt).toEqual(existingDate);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('deletes notification with scoped ownership or throws NotFoundException', async () => {
    prisma.notification.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      service.delete('notif-1', 'user-1', ROLE.USER),
    ).resolves.toEqual({ success: true });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: 'notif-1', userId: 'user-1', role: ROLE.USER },
    });

    prisma.notification.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      service.delete('notif-2', 'user-1', ROLE.USER),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('NotificationsService live-notification subscriber (connection budget)', () => {
  const original = process.env.PROCESS_ROLE;
  afterEach(() => {
    if (original === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = original;
  });

  function build() {
    const sub = {
      on: jest.fn(),
      subscribe: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    const redis = {
      duplicate: jest.fn().mockReturnValue(sub),
      publish: jest.fn(),
    };
    const service = new NotificationsService({} as never, redis as never);
    return { service, redis, sub };
  }

  it.each(['api', 'all'])(
    'opens the subscriber connection in the %s program',
    async (role) => {
      process.env.PROCESS_ROLE = role;
      const { service, redis, sub } = build();
      await service.onModuleInit();
      expect(redis.duplicate).toHaveBeenCalledTimes(1);
      expect(sub.subscribe).toHaveBeenCalled();
      await service.onModuleDestroy();
    },
  );

  it.each(['worker', 'jobs'])(
    'does not open it in the %s program',
    async (role) => {
      process.env.PROCESS_ROLE = role;
      const { service, redis } = build();
      await service.onModuleInit();
      expect(redis.duplicate).not.toHaveBeenCalled();
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    },
  );
});
