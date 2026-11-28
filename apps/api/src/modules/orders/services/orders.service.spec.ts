import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { PaymentsService } from '@api/modules/payments/services/payments.service';
import { DiscountCodeService } from '@api/modules/discounts/services/discount-code.service';
import { UsersService } from '@api/modules/users/services/users.service';
import { WalletService } from '@api/modules/wallets/services/wallet.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';
import { OrderStatusService } from './order-status.service';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let mockPrisma: any;
  let mockUsersService: any;
  let mockDiscountService: any;
  let mockPaymentsService: any;
  let mockWalletService: any;
  let mockConfigService: any;
  let mockOutbox: any;

  beforeEach(() => {
    mockPrisma = {
      order: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      orderItem: {
        createMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      orderStatusHistory: {
        create: jest.fn(),
      },
      discountCodeUsage: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      discountCode: { updateMany: jest.fn() },
      discountCodeUserUsage: { updateMany: jest.fn() },
      discountCodeClaim: { updateMany: jest.fn() },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      payment: {
        create: jest.fn(),
        update: jest.fn(),
      },
      checkoutIdempotency: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      shippingAddress: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      stockHistory: {
        createMany: jest.fn(),
      },
      cart: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
      },
      cartItem: {
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          email: 'customer@example.com',
          firstName: 'John',
          lastName: 'Doe',
        }),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
        callback(mockPrisma),
      ),
    };

    mockUsersService = {
      assertActiveAccount: jest.fn().mockResolvedValue(undefined),
    };

    mockDiscountService = {
      validate: jest.fn(),
      calculateDiscount: jest.fn(),
      recordUsage: jest.fn(),
      validateForCart: jest.fn(),
      invalidateFirstOrderCache: jest.fn().mockResolvedValue(undefined),
    };

    mockPaymentsService = {
      initializeForOrder: jest.fn().mockResolvedValue({
        authorizationUrl: 'https://paystack.com/auth',
        accessCode: 'acc-123',
        reference: 'ref-123',
        paymentId: 'pay-123',
      }),
    };

    mockWalletService = {
      settleVendorEarning: jest.fn(),
    };

    mockConfigService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'CHECKOUT_REVALIDATE_PRICES') return 'true';
        if (key === 'DEFAULT_CURRENCY') return 'ngn';
        return '';
      }),
      get: jest.fn(),
    };

    mockOutbox = {
      appendEvent: jest.fn(),
      appendEnvelope: jest.fn(),
      wakeRelay: jest.fn(),
    };

    service = new OrdersService(
      mockPrisma,
      mockUsersService,
      new OrderStatusService(
        new TransactionRunnerService(mockPrisma, mockOutbox),
        mockWalletService,
      ),
    );
  });

  describe('cancelMine (Customer order cancellation)', () => {
    it('rejects cancellation if order was already paid (must use refund workflow)', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        id: 'ord-paid',
        userId: 'u-1',
        status: OrderStatus.PROCESSING,
        payment: { status: PaymentStatus.SUCCESS },
      });

      await expect(service.cancelMine('u-1', 'ord-paid')).rejects.toThrow(
        'A refund is required before cancellation.',
      );
    });

    it('cancels unpaid pending order, restores stock, and marks stockRestored', async () => {
      const order = {
        id: 'ord-unpaid',
        userId: 'u-1',
        status: OrderStatus.PENDING,
        stockRestored: false,
        payment: { id: 'pay-1', status: PaymentStatus.PENDING },
        orderItems: [{ productId: 'p-1', variantId: null, quantity: 2 }],
      };

      mockPrisma.order.findFirst.mockResolvedValue(order);
      mockPrisma.order.findUnique.mockResolvedValue(order);
      mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.update.mockResolvedValue({
        ...order,
        status: OrderStatus.CANCELLED,
        stockRestored: true,
      });
      mockPrisma.orderStatusHistory.create.mockResolvedValue({ id: 'osh-1' });

      // Stock restoration raw query mock
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: 'p-1', oldStock: 5, newStock: 7 },
      ]);

      await service.cancelMine('u-1', 'ord-unpaid');

      // Verify order status moved to CANCELLED
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ord-unpaid', status: OrderStatus.PENDING },
          data: { status: OrderStatus.CANCELLED },
        }),
      );

      // Verify stock was restored
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ord-unpaid' },
          data: { stockRestored: true },
        }),
      );

      // Verify payment was marked FAILED
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-1' },
          data: { status: PaymentStatus.FAILED },
        }),
      );
    });
  });

  describe('updateStatusForVendor (multi-vendor guard)', () => {
    it('refuses to ship or deliver when another vendor has items on the order', async () => {
      mockPrisma.orderItem.findFirst.mockResolvedValue({ orderId: 'o-1' });
      mockPrisma.orderItem.findMany.mockResolvedValue([
        { vendorId: 'v-1' },
        { vendorId: 'v-2' },
      ]);

      await expect(
        service.updateStatusForVendor('v-1', 'o-1', OrderStatus.DELIVERED),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('still rejects a vendor that has no items on the order', async () => {
      mockPrisma.orderItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStatusForVendor('v-9', 'o-1', OrderStatus.SHIPPED),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
