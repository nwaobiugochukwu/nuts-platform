import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  PaymentRefundStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { FakeTransactionRunner } from '@api/infrastructure/database/fake-transaction-runner-spec';
import { PaymentRefundsService } from '../services/payment-refunds.service';

jest.mock('@api/modules/discounts/utils/discount-funding.util', () => ({
  loadCreditedVendorEarnings: jest
    .fn()
    .mockResolvedValue(new Map([['vendor-1', new Prisma.Decimal(4000)]])),
  releaseDiscountUsage: jest.fn().mockResolvedValue(undefined),
}));

const D = (n: number) => new Prisma.Decimal(n);

describe('PaymentRefundsService', () => {
  let prisma: any;
  let runner: FakeTransactionRunner;
  let wallet: { debitVendorPending: jest.Mock };
  let paystack: {
    post: jest.Mock;
    get: jest.Mock;
    assertConfigured: jest.Mock;
  };
  let service: PaymentRefundsService;

  const payment = (over: object = {}) => ({
    id: 'pay_1',
    orderId: 'order_1',
    userId: 'user_1',
    amount: D(5000),
    currency: 'ngn',
    status: PaymentStatus.SUCCESS,
    transactionId: 'txn_abc',
    transactionReference: 'ref_abc',
    order: {
      id: 'order_1',
      status: OrderStatus.PROCESSING,
      orderNumber: 'N-1',
      stockRestored: false,
      orderItems: [
        {
          productId: 'p1',
          variantId: null,
          quantity: 2,
          vendorId: 'vendor-1',
          unitPrice: D(2500),
        },
      ],
    },
    ...over,
  });

  /** A refund attempt as the settle step loads it. */
  const attempt = (over: object = {}) => ({
    id: 'refund_1',
    paymentId: 'pay_1',
    amount: D(5000),
    status: PaymentRefundStatus.REQUESTED,
    providerReference: 'nuts_refund_abc',
    requestedByAdminId: 'admin_1',
    previousOrderStatus: OrderStatus.PROCESSING,
    payment: payment({ order: payment().order }),
    ...over,
  });

  beforeEach(() => {
    prisma = {
      payment: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      paymentRefund: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      orderStatusHistory: { create: jest.fn() },
      stockHistory: { createMany: jest.fn() },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 'p1', oldStock: 3, newStock: 5 }]),
    };
    runner = new FakeTransactionRunner(prisma);
    wallet = { debitVendorPending: jest.fn().mockResolvedValue(undefined) };
    paystack = {
      post: jest.fn(),
      get: jest.fn(),
      assertConfigured: jest.fn(),
    };
    service = new PaymentRefundsService(
      prisma,
      runner as never,
      wallet as never,
      paystack as never,
    );
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  describe('asking for a refund', () => {
    it('refuses a payment that does not exist', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.refund('missing', 'admin_1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a payment that did not succeed', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        payment({ status: PaymentStatus.PENDING }),
      );

      await expect(service.refund('pay_1', 'admin_1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it.each([10000, 0, -100])(
      'refuses a partial amount (%s): only full refunds exist',
      async (amount) => {
        prisma.payment.findUnique.mockResolvedValue(payment());

        await expect(
          service.refund('pay_1', 'admin_1', amount),
        ).rejects.toThrow('Partial refunds are not supported.');
      },
    );

    it.each([OrderStatus.SHIPPED, OrderStatus.DELIVERED])(
      'refuses once the order is %s',
      async (status) => {
        prisma.payment.findUnique.mockResolvedValue(
          payment({ order: { ...payment().order, status } }),
        );

        await expect(service.refund('pay_1', 'admin_1')).rejects.toThrow(
          /before an order ships/,
        );
      },
    );

    it('claims the payment and order, saves the attempt and its audit entry in one transaction, then submits it', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment());
      prisma.paymentRefund.create.mockResolvedValue(attempt());
      // The submit step: nothing at Paystack yet, so it creates the refund, which is pending.
      prisma.paymentRefund.findUnique.mockResolvedValue(attempt());
      prisma.paymentRefund.findUniqueOrThrow.mockResolvedValue({
        attempts: 1,
        status: PaymentRefundStatus.PENDING,
      });
      paystack.get.mockResolvedValue({ status: true, data: [] });
      paystack.post.mockResolvedValue({
        status: true,
        data: {
          id: 9,
          reference: 'nuts_refund_abc',
          status: 'pending',
          amount: 500000,
        },
      });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(
        payment({ status: PaymentStatus.REFUND_PENDING }),
      );

      const result = await service.refund('pay_1', 'admin_1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay_1', status: PaymentStatus.SUCCESS },
        data: { status: PaymentStatus.REFUND_PENDING },
      });
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order_1', status: OrderStatus.PROCESSING },
        data: { status: OrderStatus.REFUND_PENDING },
      });
      expect(prisma.paymentRefund.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          paymentId: 'pay_1',
          amount: D(5000),
          status: PaymentRefundStatus.REQUESTED,
          requestedByAdminId: 'admin_1',
          previousOrderStatus: OrderStatus.PROCESSING,
          providerReference: expect.stringMatching(/^nuts_refund_/),
        }),
      });
      expect(runner.runs[0]).toBe('payment.refund.request');
      expect(runner.audited[0]).toMatchObject({
        action: 'PAYMENT_REFUND_REQUESTED',
        entity: 'PAYMENT',
        entityId: 'pay_1',
        adminId: 'admin_1',
      });
      expect(paystack.post).toHaveBeenCalledWith(
        'https://api.paystack.co/refund',
        {
          transaction: 'txn_abc',
          amount: 500000,
          reference: 'nuts_refund_abc',
        },
      );
      expect(result).toMatchObject({ id: 'pay_1' });
    });

    it('says the payment changed when another request claimed it first', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment());
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refund('pay_1', 'admin_1')).rejects.toThrow(
        /payment changed/,
      );
      expect(prisma.paymentRefund.create).not.toHaveBeenCalled();
    });

    it('does not claim twice: a refund already in flight is submitted again, not created again', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        payment({ status: PaymentStatus.REFUND_PENDING }),
      );
      prisma.paymentRefund.findFirst.mockResolvedValue(attempt());
      prisma.paymentRefund.findUnique.mockResolvedValue(attempt());
      prisma.paymentRefund.findUniqueOrThrow.mockResolvedValue({ attempts: 2 });
      paystack.get.mockResolvedValue({
        status: true,
        data: [
          {
            id: 9,
            reference: 'nuts_refund_abc',
            status: 'pending',
            amount: 500000,
          },
        ],
      });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(payment());

      await service.refund('pay_1', 'admin_1');

      expect(prisma.paymentRefund.create).not.toHaveBeenCalled();
      expect(paystack.post).not.toHaveBeenCalled();
    });
  });

  describe('a refund.processed webhook', () => {
    const processed = (data: object = {}) => ({
      event: 'refund.processed',
      data: {
        refund_reference: 'nuts_refund_abc',
        status: 'processed',
        amount: 500000,
        currency: 'NGN',
        id: 77,
        ...data,
      },
    });

    beforeEach(() => {
      prisma.paymentRefund.findUnique.mockResolvedValue(attempt());
    });

    it('settles everything together: refund, payment, order, stock, vendor wallet, audit and the customer notice', async () => {
      await service.handleWebhook(processed());

      expect(prisma.paymentRefund.updateMany).toHaveBeenCalledWith({
        where: { id: 'refund_1', status: { in: expect.any(Array) } },
        data: expect.objectContaining({
          status: PaymentRefundStatus.PROCESSED,
          providerRefundId: '77',
        }),
      });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay_1', status: PaymentStatus.REFUND_PENDING },
        data: { status: PaymentStatus.REFUNDED },
      });
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order_1', status: OrderStatus.REFUND_PENDING },
        data: { status: OrderStatus.REFUNDED },
      });
      // Stock goes back once, and the order remembers it.
      expect(prisma.stockHistory.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order_1' },
        data: { stockRestored: true },
      });
      // What was credited to the vendor is taken back, in the same transaction.
      expect(wallet.debitVendorPending).toHaveBeenCalledWith(
        'vendor-1',
        D(4000),
        'order_1',
        prisma,
      );
      expect(runner.runs).toEqual(['payment.refund.apply-status']);
      expect(runner.audited[0]).toMatchObject({
        action: 'PAYMENT_REFUNDED',
        entityId: 'pay_1',
      });
      expect(runner.emitted[0]).toMatchObject({
        aggregateType: 'payment_refund',
        aggregateId: 'refund_1',
        payload: expect.objectContaining({
          userId: 'user_1',
          dedupeKey: 'PAYMENT_REFUNDED:refund_1:USER:user_1',
        }),
      });
    });

    it('does not restore stock a second time when the order already has it back', async () => {
      const done = attempt();
      done.payment.order.stockRestored = true;
      prisma.paymentRefund.findUnique.mockResolvedValue(done);

      await service.handleWebhook(processed());

      expect(prisma.stockHistory.createMany).not.toHaveBeenCalled();
    });

    it('does nothing when a redelivery finds the refund already settled', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(
        attempt({ status: PaymentRefundStatus.PROCESSED }),
      );

      await service.handleWebhook(processed());

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(wallet.debitVendorPending).not.toHaveBeenCalled();
    });

    it('does nothing when another worker claimed the settlement first', async () => {
      prisma.paymentRefund.updateMany.mockResolvedValue({ count: 0 });

      await service.handleWebhook(processed());

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(runner.audited).toHaveLength(0);
    });

    it('rolls back (throws) when the payment or order is not in the refund-pending state', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.handleWebhook(processed() as never)).rejects.toThrow(
        /Could not complete local state transition/,
      );
    });

    it('rejects an amount that is not the attempt’s amount', async () => {
      await expect(
        service.handleWebhook(processed({ amount: 100 }) as never),
      ).rejects.toThrow(/amount does not match/);
      expect(prisma.paymentRefund.updateMany).not.toHaveBeenCalled();
    });

    it('rejects another currency', async () => {
      await expect(
        service.handleWebhook(processed({ currency: 'USD' }) as never),
      ).rejects.toThrow(/currency does not match/);
    });

    it('acknowledges an event for a refund we never made, without changing anything', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(null);
      prisma.paymentRefund.findFirst.mockResolvedValue(null);

      await expect(
        service.handleWebhook(processed() as never),
      ).resolves.toBeUndefined();
      expect(prisma.paymentRefund.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('a refund.failed webhook', () => {
    it('puts the payment and the order back as they were, and records why', async () => {
      prisma.paymentRefund.findUnique.mockResolvedValue(attempt());

      await service.handleWebhook({
        event: 'refund.failed',
        data: { refund_reference: 'nuts_refund_abc', status: 'failed' },
      });

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay_1', status: PaymentStatus.REFUND_PENDING },
        data: { status: PaymentStatus.SUCCESS },
      });
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order_1', status: OrderStatus.REFUND_PENDING },
        data: { status: OrderStatus.PROCESSING },
      });
      expect(runner.audited[0]).toMatchObject({
        action: 'PAYMENT_REFUND_FAILED',
      });
      expect(wallet.debitVendorPending).not.toHaveBeenCalled();
      expect(prisma.stockHistory.createMany).not.toHaveBeenCalled();
    });
  });

  describe('reconciling refunds that did not settle', () => {
    it('records why an attempt could not complete, so an operator can see it', async () => {
      prisma.paymentRefund.findMany.mockResolvedValue([{ id: 'refund_1' }]);
      prisma.paymentRefund.findUnique.mockResolvedValue(attempt());
      prisma.paymentRefund.findUniqueOrThrow.mockResolvedValue({ attempts: 3 });
      paystack.get.mockRejectedValue(new Error('paystack down'));

      await (service as any).reconcilePendingRefundsOnce();

      expect(prisma.paymentRefund.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'refund_1', status: { in: expect.any(Array) } },
        data: { lastError: 'paystack down' },
      });
    });

    it('reports attempts that reached the automatic limit', async () => {
      prisma.paymentRefund.count.mockResolvedValue(2);
      const error = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      await (service as any).reconcilePendingRefundsOnce();

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('2 refund attempt(s) reached'),
      );
    });
  });
});
