import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { PaymentsService } from '@api/modules/payments/payments.service';
import { DiscountCodeService } from '@api/modules/promotions/discount-code.service';
import { ReferralService } from '@api/modules/referral/referral.service';
import { AuditLogService } from '@api/common/audit-log/audit-log.service';
import { UsersService } from '@api/modules/users/users.service';
import { WalletService } from '@api/modules/wallet/wallet.service';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let mockPrisma: any;
  let mockUsersService: any;
  let mockDiscountService: any;
  let mockPaymentsService: any;
  let mockEmailService: any;
  let mockWalletService: any;
  let mockEventEmitter: any;
  let mockConfigService: any;

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
      },
      orderStatusHistory: {
        create: jest.fn(),
      },
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

    mockEventEmitter = {
      emit: jest.fn(),
    };

    mockConfigService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'CHECKOUT_REVALIDATE_PRICES') return 'true';
        if (key === 'DEFAULT_CURRENCY') return 'ngn';
        return '';
      }),
      get: jest.fn(),
    };

    mockEmailService = {
      sendOrderConfirmation: jest.fn(),
      sendOrderDelivered: jest.fn(),
    };

    service = new OrdersService(
      mockPrisma,
      mockUsersService,
      mockDiscountService,
      {} as unknown as ReferralService,
      mockPaymentsService,
      mockEmailService,
      { log: jest.fn() } as unknown as AuditLogService,
      mockWalletService,
      mockEventEmitter,
      { appendEvent: jest.fn() } as any,
      mockConfigService,
    );
  });

  describe('checkout parameter validations', () => {
    it('throws BadRequestException if idempotency key is missing or blank', async () => {
      await expect(
        service.checkout('u-1', {} as any, 'addr-1', ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if idempotency key exceeds 255 characters', async () => {
      const longKey = 'a'.repeat(256);
      await expect(
        service.checkout('u-1', {} as any, 'addr-1', longKey),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if neither addressId nor shippingAddress is provided', async () => {
      await expect(
        service.checkout('u-1', {} as any, undefined, 'key-1'),
      ).rejects.toThrow('A shipping address is required.');
    });

    it('throws BadRequestException if both addressId and inline shippingAddress are provided', async () => {
      await expect(
        service.checkout(
          'u-1',
          {
            shippingAddress: {
              fullName: 'John Doe',
              phone: '123',
              street: 'St',
              city: 'City',
              state: 'State',
            },
          } as any,
          'addr-1',
          'key-1',
        ),
      ).rejects.toThrow(
        'Provide either addressId or shippingAddress, not both.',
      );
    });
  });

  describe('checkout idempotency and replay', () => {
    it('returns existing order without duplicate insertion when idempotency key is reused', async () => {
      const existingOrder = {
        id: 'ord-100',
        orderNumber: 'ORD100',
        status: OrderStatus.PENDING,
        totalAmount: new Prisma.Decimal(1000),
        discountAmount: new Prisma.Decimal(0),
        finalAmount: new Prisma.Decimal(1000),
        orderItems: [],
        payment: { id: 'pay-1', status: PaymentStatus.PENDING },
      };

      // Mock cart lock query returning an active cart
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'cart-1' }]);

      // Mock idempotency record found inside transaction
      mockPrisma.checkoutIdempotency.findUnique.mockResolvedValue({
        orderId: 'ord-100',
        expiresAt: new Date(Date.now() + 3600000),
      });

      mockPrisma.order.findUnique.mockResolvedValue(existingOrder);

      const result = await service.checkout(
        'u-1',
        {
          shippingAddress: {
            fullName: 'Jane',
            phone: '123',
            street: 'St',
            city: 'City',
            state: 'State',
          },
        },
        undefined,
        'idempotent-key-repeat',
      );

      expect(result.id).toBe('ord-100');
      // Verifies no new order created
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });
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

  describe('sendOrderConfirmationEmail', () => {
    it('sends order confirmation with invoice when invoked for an order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        orderNumber: 'ORD-12345',
        shippingAddress: '123 Test St',
        totalAmount: new Prisma.Decimal(1000),
        discountAmount: new Prisma.Decimal(0),
        discountCode: null,
        finalAmount: new Prisma.Decimal(1000),
        createdAt: new Date(),
        user: {
          email: 'customer@test.com',
          firstName: 'John',
          lastName: 'Doe',
        },
        orderItems: [
          {
            quantity: 1,
            unitPrice: new Prisma.Decimal(1000),
            product: { name: 'Test Product' },
          },
        ],
      });

      await service.sendOrderConfirmationEmail('ord-1');

      expect(mockEmailService.sendOrderConfirmation).toHaveBeenCalledWith(
        'customer@test.com',
        expect.objectContaining({
          orderNumber: 'ORD-12345',
          customerEmail: 'customer@test.com',
          totalAmount: 1000,
        }),
      );
    });
  });
});
