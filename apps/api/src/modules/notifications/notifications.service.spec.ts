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
