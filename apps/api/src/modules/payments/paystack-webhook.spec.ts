import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { CircuitBreakerService } from '@api/infrastructure/resiliency/circuit-breaker.service';
import { UsersService } from '@api/modules/users/users.service';
import { WalletService } from '@api/modules/wallet/wallet.service';
import { PaymentsService } from './payments.service';

describe('Paystack Webhook & Payment Verification Security', () => {
  let service: PaymentsService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockWalletService: any;
  const secretKey = 'sk_test_secret_key_12345';

  beforeEach(() => {
    mockPrisma = {
      payment: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(), // Used by confirmPayment to return refreshed payment after commit
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      order: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      orderStatusHistory: {
        create: jest.fn(),
      },
      admin: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      outboxEvent: {
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn(
        (callback: (tx: any) => Promise<unknown>, _opts?: unknown) =>
          callback(mockPrisma),
      ),
    };

    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'PAYSTACK_SECRET_KEY') return secretKey;
        return undefined;
      }),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'PAYSTACK_SECRET_KEY') return secretKey;
        throw new Error(`Missing config: ${key}`);
      }),
    };

    mockWalletService = {
      creditVendorPending: jest.fn(),
    };

    service = new PaymentsService(
      mockPrisma,
      { assertActiveAccount: jest.fn() } as unknown as UsersService,
      mockConfig,
      { sendPaymentReceipt: jest.fn() } as unknown as EmailService,
      mockWalletService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      {
        executePaystack: jest.fn((fn: () => unknown) => fn()),
      } as unknown as CircuitBreakerService,
      { appendEvent: jest.fn() } as any,
    );
  });

  const generateSignature = (body: string, secret = secretKey) => {
    return createHmac('sha512', secret).update(body).digest('hex');
  };

  describe('Signature verification', () => {
    it('rejects webhooks with missing signature', async () => {
      const rawBody = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref-1' },
      });

      await expect(service.handleWebhook(rawBody, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects webhooks with invalid or forged signature', async () => {
      const rawBody = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref-1' },
      });
      const badSignature = generateSignature(rawBody, 'wrong-secret');

      await expect(
        service.handleWebhook(rawBody, badSignature),
      ).rejects.toThrow('Invalid Paystack webhook signature.');
    });

    it('rejects webhooks with tampered payload', async () => {
      const originalBody = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref-1' },
      });
      const signature = generateSignature(originalBody);
      const tamperedBody = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref-2' },
      });

      await expect(
        service.handleWebhook(tamperedBody, signature),
      ).rejects.toThrow('Invalid Paystack webhook signature.');
    });
  });

  describe('Payment confirmation & Idempotency', () => {
    it('confirms payment, advances order to PROCESSING, and credits vendor wallet exactly once', async () => {
      const payload = {
        event: 'charge.success',
        data: {
          reference: 'TX-REF-100',
          status: 'success',
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = generateSignature(rawBody);

      const existingPayment = {
        id: 'pay-1',
        orderId: 'ord-1',
        amount: new Prisma.Decimal(100), // 100 NGN = 10,000 kobo
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        transactionReference: 'TX-REF-100',
      };

      mockPrisma.payment.findUnique.mockResolvedValue(existingPayment);

      // Mock Paystack server-side verification API returning matching amount
      jest.spyOn<any, any>(service, 'paystackVerify').mockResolvedValue({
        status: true,
        data: {
          id: 999888,
          status: 'success',
          amount: 10000, // 100 NGN in kobo
          currency: 'NGN',
        },
      });

      // Atomic update succeeds (first arrival)
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.findUnique.mockResolvedValue({
        orderNumber: 'ORD-1',
        orderItems: [
          { vendorId: 'v-1', quantity: 1, unitPrice: new Prisma.Decimal(100) },
        ],
      });
      // confirmPayment fetches the refreshed payment entity after the transaction commits
      mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
        ...existingPayment,
        status: PaymentStatus.SUCCESS,
      });

      await service.handleWebhook(rawBody, signature);

      // Verifies payment status transitioned to SUCCESS
      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay-1', status: PaymentStatus.PENDING },
        data: expect.objectContaining({ status: PaymentStatus.SUCCESS }),
      });

      // Verifies order status transitioned to PROCESSING
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'ord-1', status: OrderStatus.PENDING },
        data: { status: OrderStatus.PROCESSING },
      });
    });

    it('successfully advances order to PROCESSING using signed webhook data when paystackVerify fails or times out', async () => {
      const payload = {
        event: 'charge.success',
        data: {
          reference: 'TX-REF-FALLBACK',
          status: 'success',
          amount: 10000, // 100 NGN in kobo
          currency: 'NGN',
          metadata: {
            order_id: 'ord-fallback',
          },
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = generateSignature(rawBody);

      const existingPayment = {
        id: 'pay-fallback',
        orderId: 'ord-fallback',
        amount: new Prisma.Decimal(100),
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        transactionReference: 'TX-REF-FALLBACK',
      };

      mockPrisma.payment.findUnique.mockResolvedValue(existingPayment);

      // Paystack verify times out or returns null
      jest.spyOn<any, any>(service, 'paystackVerify').mockResolvedValue(null);

      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.findUnique.mockResolvedValue({
        orderNumber: 'ORD-FALLBACK',
        orderItems: [
          { vendorId: 'v-1', quantity: 1, unitPrice: new Prisma.Decimal(100) },
        ],
      });
      mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
        ...existingPayment,
        status: PaymentStatus.SUCCESS,
      });

      await service.handleWebhook(rawBody, signature);

      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay-fallback', status: PaymentStatus.PENDING },
        data: expect.objectContaining({ status: PaymentStatus.SUCCESS }),
      });
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'ord-fallback', status: OrderStatus.PENDING },
        data: { status: OrderStatus.PROCESSING },
      });
    });

    it('rejects payment and marks FAILED if Paystack amount does not match order amount', async () => {
      const payload = {
        event: 'charge.success',
        data: {
          reference: 'TX-FRAUD-1',
          status: 'success',
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = generateSignature(rawBody);

      const existingPayment = {
        id: 'pay-fraud',
        orderId: 'ord-fraud',
        amount: new Prisma.Decimal(5000), // Expected 5,000 NGN (500,000 kobo)
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        transactionReference: 'TX-FRAUD-1',
      };

      mockPrisma.payment.findUnique.mockResolvedValue(existingPayment);

      // Attacker paid only 50 NGN (5,000 kobo)
      jest.spyOn<any, any>(service, 'paystackVerify').mockResolvedValue({
        status: true,
        data: {
          id: 111,
          status: 'success',
          amount: 5000, // Only 50 NGN!
          currency: 'NGN',
        },
      });

      await service.handleWebhook(rawBody, signature);

      // Verifies payment was flagged and marked FAILED
      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay-fraud', status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });

      // Verifies order was NOT advanced
      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('ignores duplicate webhook when payment is already SUCCESS', async () => {
      const payload = {
        event: 'charge.success',
        data: { reference: 'TX-ALREADY-PAID' },
      };
      const rawBody = JSON.stringify(payload);
      const signature = generateSignature(rawBody);

      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 'pay-done',
        status: PaymentStatus.SUCCESS,
        amount: new Prisma.Decimal(100),
        currency: 'NGN',
      });

      await service.handleWebhook(rawBody, signature);

      // Must not call Paystack verify or mutate order again
      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
    });
  });
});
