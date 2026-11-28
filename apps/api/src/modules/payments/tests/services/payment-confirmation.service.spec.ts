import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { CART_CACHE_PREFIX } from '@api/modules/cart/services/cart.service';
import { FakeTransactionRunner } from '@api/infrastructure/database/fake-transaction-runner-spec';
import { PaymentConfirmationService } from '../../services/payment-confirmation.service';

const D = (n: number) => new Prisma.Decimal(n);

describe('PaymentConfirmationService', () => {
  let prisma: any;
  let runner: FakeTransactionRunner;
  let paystack: { verifyTransaction: jest.Mock };
  let wallet: { creditVendorPending: jest.Mock };
  let cache: { del: jest.Mock };
  let service: PaymentConfirmationService;

  const pending = (over: object = {}) => ({
    id: 'pay-1',
    orderId: 'ord-1',
    userId: 'u-1',
    amount: D(100),
    currency: 'NGN',
    status: PaymentStatus.PENDING,
    transactionReference: 'REF-1',
    ...over,
  });
  const paid = (over: object = {}) => ({
    status: true,
    data: {
      id: 55,
      status: 'success',
      amount: 10000,
      currency: 'NGN',
      ...over,
    },
  });
  const order = (over: object = {}) => ({
    id: 'ord-1',
    orderNumber: 'ORD-1',
    status: OrderStatus.PROCESSING,
    orderItems: [
      {
        productId: 'p1',
        vendorId: 'v-1',
        quantity: 2,
        unitPrice: D(50),
        recommendationContext: null,
      },
      {
        productId: 'p2',
        vendorId: 'v-2',
        quantity: 1,
        unitPrice: D(0),
        recommendationContext: null,
      },
    ],
    ...over,
  });

  beforeEach(() => {
    prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(pending()),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue(pending({ status: PaymentStatus.SUCCESS })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(order()),
      },
      orderStatusHistory: { create: jest.fn() },
      recommendationEvent: { createMany: jest.fn() },
      discountCodeUsage: { findMany: jest.fn().mockResolvedValue([]) },
      admin: {
        findMany: jest.fn().mockResolvedValue([{ id: 'a-1' }, { id: 'a-2' }]),
      },
    };
    runner = new FakeTransactionRunner(prisma);
    paystack = { verifyTransaction: jest.fn().mockResolvedValue(paid()) };
    wallet = { creditVendorPending: jest.fn().mockResolvedValue(undefined) };
    cache = { del: jest.fn().mockResolvedValue(undefined) };
    service = new PaymentConfirmationService(
      prisma,
      runner as never,
      paystack as never,
      wallet as never,
      cache as never,
    );
    jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  it('records the charge once: payment, order, history, vendor credit, notices, audit', async () => {
    const result = await service.confirm('REF-1');

    expect(result).toMatchObject({ id: 'pay-1' });
    expect(runner.runs).toEqual(['payment.confirm']);
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: PaymentStatus.PENDING },
      data: {
        status: PaymentStatus.SUCCESS,
        transactionId: '55',
        paymentMethod: 'paystack',
      },
    });
    expect(prisma.orderStatusHistory.create).toHaveBeenCalledTimes(1);
    // Vendor v-2's earnings are zero, so only v-1 is credited, inside the transaction.
    expect(wallet.creditVendorPending).toHaveBeenCalledTimes(1);
    expect(wallet.creditVendorPending).toHaveBeenCalledWith(
      'v-1',
      expect.any(Prisma.Decimal),
      'ord-1',
      prisma,
    );
    expect(runner.audited).toEqual([
      expect.objectContaining({
        action: 'PAYMENT_CONFIRMED',
        entityId: 'pay-1',
        userId: 'u-1',
        payload: expect.objectContaining({ settlementRequiresReview: false }),
      }),
    ]);
  });

  it('queues one notice for the customer for the payment, one for the order, one per vendor and one per admin, each with a stable dedupe key', async () => {
    await service.confirm('REF-1');

    expect(
      runner.emitted.map((e) => (e.payload as { dedupeKey: string }).dedupeKey),
    ).toEqual([
      'PAYMENT_RECEIVED:pay-1:USER:u-1',
      'ORDER_CONFIRMED:ord-1:USER:u-1',
      'ORDER_CONFIRMED:ord-1:VENDOR:v-1',
      'ORDER_CONFIRMED:ord-1:VENDOR:v-2',
      'PAYMENT_RECEIVED:pay-1:ADMIN:a-1',
      'PAYMENT_RECEIVED:pay-1:ADMIN:a-2',
    ]);
  });

  it('publishes order.processing and payment.confirmed through the transaction', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...order(),
      user: { id: 'u-1', email: 'b@x.com', firstName: 'A' },
      payment: { currency: 'NGN' },
      totalAmount: D(100),
      finalAmount: D(100),
      shippingAddress: 'x',
      orderItems: [],
    });
    prisma.payment.findUnique
      .mockResolvedValueOnce(pending())
      .mockResolvedValue({
        ...pending(),
        user: { email: 'b@x.com', firstName: 'A' },
        order: { orderNumber: 'ORD-1' },
      });

    await service.confirm('REF-1');

    expect(runner.published.map((p) => p.type)).toEqual([
      'order.processing',
      'payment.confirmed',
    ]);
  });

  it('clears the customer’s cart cache only after the transaction’s last write (the audit entry)', async () => {
    let auditedWhenCleared = -1;
    cache.del.mockImplementation(() => {
      auditedWhenCleared = runner.audited.length;
      return Promise.resolve();
    });

    await service.confirm('REF-1');

    expect(cache.del).toHaveBeenCalledWith(`${CART_CACHE_PREFIX}u-1`);
    expect(auditedWhenCleared).toBe(1);
  });

  it('a delivery that loses the race changes nothing and returns the current payment', async () => {
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue(
      pending({ status: PaymentStatus.SUCCESS }),
    );

    await service.confirm('REF-1');

    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(wallet.creditVendorPending).not.toHaveBeenCalled();
    expect(runner.emitted).toHaveLength(0);
    expect(runner.audited).toHaveLength(0);
  });

  it('flags a charge that arrived after the payment had already gone terminal, for review', async () => {
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue(
      pending({ status: PaymentStatus.FAILED }),
    );

    await service.confirm('REF-1');

    expect(runner.audited[0]).toMatchObject({
      action: 'PAYMENT_CAPTURED_AFTER_PAYMENT_TERMINAL',
      payload: expect.objectContaining({ settlementRequiresReview: true }),
    });
    expect(wallet.creditVendorPending).not.toHaveBeenCalled();
  });

  it('when the order was no longer pending, credits nobody, sends nothing and flags it for review', async () => {
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await service.confirm('REF-1');

    expect(wallet.creditVendorPending).not.toHaveBeenCalled();
    expect(runner.emitted).toHaveLength(0);
    expect(runner.published).toHaveLength(0);
    expect(cache.del).not.toHaveBeenCalled();
    expect(runner.audited[0]).toMatchObject({
      action: 'PAYMENT_CAPTURED_ORDER_NOT_PENDING',
      payload: expect.objectContaining({ settlementRequiresReview: true }),
    });
  });

  it.each([
    ['the amount is wrong', paid({ amount: 5 })],
    ['the currency is wrong', paid({ currency: 'USD' })],
  ])(
    'refuses a charge when %s, and marks the payment failed',
    async (_l, v) => {
      paystack.verifyTransaction.mockResolvedValue(v);

      await expect(service.confirm('REF-1')).resolves.toBeNull();

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay-1', status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });
      expect(wallet.creditVendorPending).not.toHaveBeenCalled();
    },
  );

  it('marks the payment failed when Paystack says the charge failed', async () => {
    paystack.verifyTransaction.mockResolvedValue({
      status: true,
      data: { status: 'failed' },
    });

    await expect(service.confirm('REF-1')).resolves.toBeNull();

    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.FAILED },
    });
  });

  it('leaves it pending (null) when Paystack cannot say yet and there is no signed webhook', async () => {
    paystack.verifyTransaction.mockResolvedValue({ status: false });

    await expect(service.confirm('REF-1')).resolves.toBeNull();

    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('does not touch a payment that is already settled', async () => {
    for (const status of [
      PaymentStatus.SUCCESS,
      PaymentStatus.REFUNDED,
      PaymentStatus.REFUND_PENDING,
    ]) {
      prisma.payment.findUnique.mockResolvedValue(pending({ status }));
      await service.confirm('REF-1');
    }

    expect(paystack.verifyTransaction).not.toHaveBeenCalled();
    expect(runner.runs).toHaveLength(0);
  });

  it('knows nothing of an unknown reference', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);

    await expect(service.confirm('nope')).resolves.toBeNull();
  });

  it('settles a zero-total order without asking Paystack, only when the stored amount is zero', async () => {
    prisma.payment.findUnique.mockResolvedValue(pending({ amount: D(0) }));
    await service.confirm('REF-1', undefined, undefined, true);
    expect(paystack.verifyTransaction).not.toHaveBeenCalled();
    expect(runner.runs).toEqual(['payment.confirm']);

    // The same flag on a payment that does have an amount is not trusted.
    prisma.payment.findUnique.mockResolvedValue(pending());
    await service.confirm('REF-1', undefined, undefined, true);
    expect(paystack.verifyTransaction).toHaveBeenCalledTimes(1);
  });

  describe('marking a payment failed', () => {
    const failing = () =>
      prisma.payment.findFirst.mockResolvedValue({
        ...pending(),
        user: { email: 'b@x.com', firstName: 'A' },
        order: { orderNumber: 'ORD-1' },
      });

    it('publishes payment.failed in the transaction that moved it', async () => {
      failing();

      await service.markFailed('REF-1', 'declined');

      expect(runner.runs).toEqual(['payment.mark-failed']);
      expect(runner.published[0]).toMatchObject({
        type: 'payment.failed',
        aggregate: { type: 'payment', id: 'pay-1' },
        payload: expect.objectContaining({ reason: 'declined' }),
      });
    });

    it('publishes nothing when another delivery moved it first, or there is nothing pending', async () => {
      failing();
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      await service.markFailed('REF-1');

      prisma.payment.findFirst.mockResolvedValue(null);
      await service.markFailed('REF-2');

      expect(runner.published).toHaveLength(0);
    });
  });
});
