import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { UnpaidOrdersCron } from './unpaid-orders.cron';
import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import { OrdersService } from '@api/modules/checkout/orders/orders.service';
import { REDIS_CLIENT } from '@api/modules/infrastructure/redis/redis.constants';
import { UNPAID_ORDER_EXPIRATION } from '@api/modules/shared/constants';

describe('UnpaidOrdersCron', () => {
  let cron: UnpaidOrdersCron;
  let mockPrisma: any;
  let mockOrdersService: any;
  let mockRedis: any;

  beforeEach(async () => {
    mockPrisma = {
      order: {
        findMany: jest.fn(),
      },
    };

    mockOrdersService = {
      cancelExpiredPendingOrder: jest.fn().mockResolvedValue(true),
    };

    mockRedis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnpaidOrdersCron,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OrdersService, useValue: mockOrdersService },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    cron = module.get<UnpaidOrdersCron>(UnpaidOrdersCron);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should skip execution if distributed lock is already held by another cluster pod', async () => {
    mockRedis.set.mockResolvedValue(null);

    await cron.handleExpiredUnpaidOrders();

    expect(mockRedis.set).toHaveBeenCalledWith(
      'cron:lock:unpaid-orders',
      expect.any(String),
      'PX',
      UNPAID_ORDER_EXPIRATION.LOCK_TTL_MS,
      'NX',
    );
    expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
    expect(mockOrdersService.cancelExpiredPendingOrder).not.toHaveBeenCalled();
  });

  it('should find expired orders exceeding configured window and auto-cancel them', async () => {
    const expiredOrders = [
      {
        id: 'ord-exp-1',
        orderNumber: 'NUTS-ORD-1',
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
      },
      {
        id: 'ord-exp-2',
        orderNumber: 'NUTS-ORD-2',
        createdAt: new Date(Date.now() - 50 * 60 * 1000),
      },
    ];

    mockPrisma.order.findMany.mockResolvedValue(expiredOrders);

    await cron.handleExpiredUnpaidOrders();

    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: OrderStatus.PENDING,
        }),
        take: UNPAID_ORDER_EXPIRATION.BATCH_SIZE,
      }),
    );

    expect(mockOrdersService.cancelExpiredPendingOrder).toHaveBeenCalledTimes(
      2,
    );
    expect(mockOrdersService.cancelExpiredPendingOrder).toHaveBeenCalledWith(
      'ord-exp-1',
      expect.stringContaining(
        `Payment window expired after ${UNPAID_ORDER_EXPIRATION.PENDING_TTL_MINUTES} minutes`,
      ),
    );
    expect(mockOrdersService.cancelExpiredPendingOrder).toHaveBeenCalledWith(
      'ord-exp-2',
      expect.stringContaining(
        `Payment window expired after ${UNPAID_ORDER_EXPIRATION.PENDING_TTL_MINUTES} minutes`,
      ),
    );

    // Distributed lock released at conclusion with compare-and-delete
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1]) == ARGV[1]'),
      1,
      'cron:lock:unpaid-orders',
      expect.any(String),
    );
  });

  it('should exit cleanly and release lock when no expired orders are discovered', async () => {
    mockPrisma.order.findMany.mockResolvedValue([]);

    await cron.handleExpiredUnpaidOrders();

    expect(mockOrdersService.cancelExpiredPendingOrder).not.toHaveBeenCalled();
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1]) == ARGV[1]'),
      1,
      'cron:lock:unpaid-orders',
      expect.any(String),
    );
  });

  it('should guarantee distributed lock release in finally block even if query throws', async () => {
    mockPrisma.order.findMany.mockRejectedValue(
      new Error('PostgreSQL connection drop'),
    );

    await cron.handleExpiredUnpaidOrders();

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1]) == ARGV[1]'),
      1,
      'cron:lock:unpaid-orders',
      expect.any(String),
    );
  });
});
