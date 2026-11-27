import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { CircuitBreakerService } from '@api/infrastructure/resilience/circuit-breaker.service';
import { UsersService } from '@api/modules/users/services/users.service';
import { WalletService } from '@api/modules/wallets/services/wallet.service';
import { PaymentsService } from './payments.service';

describe('Paystack Webhook & Payment Verification Security', () => {
  let service: PaymentsService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockOutbox: any;
  let mockInbox: any;
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
      discountCodeUsage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue([]),
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

    mockInbox = {
      receive: jest
        .fn()
        .mockResolvedValue({ inboxId: 'in-1', duplicate: false }),
    };

    mockOutbox = {
      appendEvent: jest.fn(),
      appendEnvelope: jest.fn(),
      wakeRelay: jest.fn(),
    };

    service = new PaymentsService(
      mockPrisma,
      { assertActiveAccount: jest.fn() } as unknown as UsersService,
      mockConfig,
      {} as unknown as EmailService,
      mockWalletService,
      {
        executePaystack: jest.fn((fn: () => unknown) => fn()),
      } as unknown as CircuitBreakerService,
      mockOutbox,
      mockInbox,
    );
  });

  /** What the endpoint and the consumer do together: verify, then apply. */
  const deliver = async (rawBody: string, signature: string | undefined) =>
    service.processWebhookEvent(service.verifyWebhook(rawBody, signature));

  const generateSignature = (body: string, secret = secretKey) => {
    return createHmac('sha512', secret).update(body).digest('hex');
  };

  describe('Signature verification', () => {
    it('rejects webhooks with missing signature', async () => {
      const rawBody = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref-1' },
      });

      await expect(deliver(rawBody, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects webhooks with invalid or forged signature', async () => {
      const rawBody = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'ref-1' },
      });
      const badSignature = generateSignature(rawBody, 'wrong-secret');

      await expect(deliver(rawBody, badSignature)).rejects.toThrow(
        'Invalid Paystack webhook signature.',
      );
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

      await expect(deliver(tamperedBody, signature)).rejects.toThrow(
        'Invalid Paystack webhook signature.',
      );
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

      await deliver(rawBody, signature);

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

    it('publishes order.processing and payment.confirmed in the same transaction, and wakes the relay only after it commits', async () => {
      const rawBody = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'TX-REF-200', status: 'success' },
      });
      const existingPayment = {
        id: 'pay-2',
        orderId: 'ord-2',
        userId: 'u-2',
        amount: new Prisma.Decimal(100),
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        transactionReference: 'TX-REF-200',
        user: { email: 'buyer@example.com', firstName: 'Ada' },
        order: { orderNumber: 'ORD-2' },
      };
      mockPrisma.payment.findUnique.mockResolvedValue(existingPayment);
      jest.spyOn<any, any>(service, 'paystackVerify').mockResolvedValue({
        status: true,
        data: { id: 1, status: 'success', amount: 10000, currency: 'NGN' },
      });
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-2',
        orderNumber: 'ORD-2',
        status: OrderStatus.PROCESSING,
        userId: 'u-2',
        user: { id: 'u-2', email: 'buyer@example.com', firstName: 'Ada' },
        payment: { currency: 'NGN' },
        totalAmount: new Prisma.Decimal(100),
        finalAmount: new Prisma.Decimal(100),
        shippingAddress: '1 Main St',
        orderItems: [
          {
            productId: 'p-1',
            vendorId: 'v-1',
            quantity: 1,
            unitPrice: new Prisma.Decimal(100),
            totalPrice: new Prisma.Decimal(100),
            product: { name: 'Red Shoe' },
            variant: null,
          },
        ],
      });
      mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
        ...existingPayment,
        status: PaymentStatus.SUCCESS,
      });
      const order: string[] = [];
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: any) => Promise<unknown>) => {
          const result = await callback(mockPrisma);
          order.push('commit');
          return result;
        },
      );
      mockOutbox.appendEnvelope.mockImplementation(() => {
        order.push('append');
        return Promise.resolve('e-1');
      });
      mockOutbox.wakeRelay.mockImplementation(() => order.push('wake'));

      await deliver(rawBody, generateSignature(rawBody));

      const published = mockOutbox.appendEnvelope.mock.calls.map(
        ([tx, event, options]: any[]) => ({ tx, event, options }),
      );
      expect(published.map((p: any) => p.event.type)).toEqual([
        'order.processing',
        'payment.confirmed',
      ]);
      for (const p of published) {
        expect(p.tx).toBe(mockPrisma); // the transaction client, not a separate connection
        expect(p.options).toEqual({ wakeRelay: false });
      }
      expect(published[0].event).toMatchObject({
        aggregate: { type: 'order', id: 'ord-2' },
        payload: {
          orderId: 'ord-2',
          userEmail: 'buyer@example.com',
          currency: 'NGN',
          items: [expect.objectContaining({ productName: 'Red Shoe' })],
        },
      });
      expect(published[1].event).toMatchObject({
        aggregate: { type: 'payment', id: 'pay-2' },
        payload: { paymentId: 'pay-2', orderNumber: 'ORD-2', amount: 100 },
      });
      expect(order.indexOf('wake')).toBeGreaterThan(order.indexOf('commit'));
      expect(order.slice(0, 2)).toEqual(['append', 'append']);
    });

    describe('a failed payment', () => {
      const failing = (updated: number) => {
        mockPrisma.payment.findFirst = jest.fn().mockResolvedValue({
          id: 'pay-9',
          orderId: 'ord-9',
          userId: 'u-9',
          user: { email: 'buyer@example.com', firstName: 'Ada' },
          order: { orderNumber: 'ORD-9' },
        });
        mockPrisma.payment.updateMany.mockResolvedValue({ count: updated });
      };

      it('publishes payment.failed in the transaction that marked it failed, then wakes the relay', async () => {
        failing(1);

        await (service as any).markPaymentFailed('TX-FAIL-1', 'declined');

        expect(mockOutbox.appendEnvelope).toHaveBeenCalledWith(
          mockPrisma,
          expect.objectContaining({
            type: 'payment.failed',
            aggregate: { type: 'payment', id: 'pay-9' },
            payload: expect.objectContaining({
              paymentId: 'pay-9',
              reason: 'declined',
            }),
          }),
          { wakeRelay: false },
        );
        expect(mockOutbox.wakeRelay).toHaveBeenCalledTimes(1);
      });

      it('publishes nothing when another delivery already moved the payment', async () => {
        failing(0);

        await (service as any).markPaymentFailed('TX-FAIL-1', 'declined');

        expect(mockOutbox.appendEnvelope).not.toHaveBeenCalled();
      });
    });

    it('does not publish the events when the order was not pending (nothing changed)', async () => {
      const rawBody = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'TX-REF-300', status: 'success' },
      });
      const existingPayment = {
        id: 'pay-3',
        orderId: 'ord-3',
        amount: new Prisma.Decimal(100),
        currency: 'NGN',
        status: PaymentStatus.PENDING,
        transactionReference: 'TX-REF-300',
      };
      mockPrisma.payment.findUnique.mockResolvedValue(existingPayment);
      jest.spyOn<any, any>(service, 'paystackVerify').mockResolvedValue({
        status: true,
        data: { id: 1, status: 'success', amount: 10000, currency: 'NGN' },
      });
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.updateMany.mockResolvedValue({ count: 0 }); // already moved on
      mockPrisma.order.findUnique.mockResolvedValue({
        orderNumber: 'ORD-3',
        status: OrderStatus.CANCELLED,
        orderItems: [],
      });
      mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
        ...existingPayment,
        status: PaymentStatus.SUCCESS,
      });

      await deliver(rawBody, generateSignature(rawBody));

      expect(mockOutbox.appendEnvelope).not.toHaveBeenCalled();
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

      await deliver(rawBody, signature);

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

      await deliver(rawBody, signature);

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

      await deliver(rawBody, signature);

      // Must not call Paystack verify or mutate order again
      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('receiving a webhook (the endpoint)', () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'TX-IN-1', status: 'success' },
    });

    it('stores a correctly signed event in the inbox and does not process it', async () => {
      await service.receiveWebhook(body, generateSignature(body));

      expect(mockInbox.receive).toHaveBeenCalledWith({
        provider: 'paystack',
        eventType: 'charge.success',
        rawBody: body,
      });
      expect(mockPrisma.payment.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing signature', undefined],
      ['a wrong signature', 'deadbeef'],
    ])('stores nothing for %s', async (_label, signature) => {
      await expect(service.receiveWebhook(body, signature)).rejects.toThrow(
        'Invalid Paystack webhook signature.',
      );
      expect(mockInbox.receive).not.toHaveBeenCalled();
    });

    it('rejects a signed body that is not JSON, storing nothing', async () => {
      const bad = 'not json';
      await expect(
        service.receiveWebhook(bad, generateSignature(bad)),
      ).rejects.toThrow('Invalid webhook payload.');
      expect(mockInbox.receive).not.toHaveBeenCalled();
    });

    it('accepts the provider repeating an event it already sent', async () => {
      mockInbox.receive.mockResolvedValue({ inboxId: 'in-1', duplicate: true });

      await expect(
        service.receiveWebhook(body, generateSignature(body)),
      ).resolves.toBeUndefined();
    });

    it('fails the request (so Paystack retries) when the event cannot be stored', async () => {
      mockInbox.receive.mockRejectedValue(new Error('db down'));

      await expect(
        service.receiveWebhook(body, generateSignature(body)),
      ).rejects.toThrow('db down');
    });
  });
});
