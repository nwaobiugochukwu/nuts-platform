import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { FakeTransactionRunner } from '@api/infrastructure/database/fake-transaction-runner-spec';
import { OrderStatusService } from './order-status.service';

jest.mock('@api/modules/discounts/utils/discount-funding.util', () => ({
  loadCreditedVendorEarnings: jest.fn(),
  loadVendorFundedDiscounts: jest.fn().mockResolvedValue(new Map()),
  releaseDiscountUsage: jest.fn().mockResolvedValue(undefined),
  computeVendorEarnings: jest.requireActual(
    '@api/modules/discounts/utils/discount-funding.util',
  ).computeVendorEarnings,
}));

import * as funding from '@api/modules/discounts/utils/discount-funding.util';

const D = (n: number) => new Prisma.Decimal(n);

describe('OrderStatusService', () => {
  let tx: any;
  let runner: FakeTransactionRunner;
  let wallet: { settleVendorEarning: jest.Mock };
  let service: OrderStatusService;

  const orderRow = (over: object = {}) => ({
    id: 'ord-1',
    orderNumber: 'ORD-1',
    userId: 'u-1',
    status: OrderStatus.PROCESSING,
    stockRestored: false,
    payment: null,
    orderItems: [
      {
        productId: 'p1',
        variantId: null,
        quantity: 2,
        vendorId: 'v-1',
        unitPrice: D(50),
        totalPrice: D(100),
      },
    ],
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(orderRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      payment: { update: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
      stockHistory: { createMany: jest.fn() },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 'p1', oldStock: 1, newStock: 3 }]),
    };
    (funding.loadVendorFundedDiscounts as jest.Mock).mockResolvedValue(
      new Map(),
    );
    runner = new FakeTransactionRunner(tx);
    wallet = { settleVendorEarning: jest.fn().mockResolvedValue(undefined) };
    service = new OrderStatusService(runner as never, wallet as never);
  });

  const go = (nextStatus: OrderStatus, extra: object = {}) =>
    service.transition({
      orderId: 'ord-1',
      nextStatus,
      changedByAdminId: 'admin-1',
      ...extra,
    });

  describe('moving an order to the next status', () => {
    it('changes the status only if it is still what we read, and records who did it', async () => {
      await go(OrderStatus.SHIPPED, { note: ' left the depot ' });

      expect(runner.runs).toEqual(['order.transition-status']);
      expect(tx.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'ord-1', status: OrderStatus.PROCESSING },
        data: { status: OrderStatus.SHIPPED },
      });
      expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'ord-1',
          fromStatus: OrderStatus.PROCESSING,
          toStatus: OrderStatus.SHIPPED,
          changedByAdminId: 'admin-1',
        }),
      });
    });

    it('does nothing when the order is already in that status', async () => {
      tx.order.findUnique.mockResolvedValue(
        orderRow({ status: OrderStatus.SHIPPED }),
      );

      await go(OrderStatus.SHIPPED);

      expect(tx.order.updateMany).not.toHaveBeenCalled();
      expect(runner.emitted).toHaveLength(0);
    });

    it('says the order does not exist', async () => {
      tx.order.findUnique.mockResolvedValue(null);

      await expect(go(OrderStatus.SHIPPED)).rejects.toThrow(NotFoundException);
    });

    it('turns a status the state machine does not allow into a bad request, changing nothing', async () => {
      tx.order.findUnique.mockResolvedValue(
        orderRow({ status: OrderStatus.DELIVERED }),
      );

      await expect(go(OrderStatus.PROCESSING)).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it('asks the caller to retry when another request changed the status first', async () => {
      tx.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(go(OrderStatus.SHIPPED)).rejects.toThrow(ConflictException);
      expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    });

    it('queues the customer’s notice and the status event in the same transaction', async () => {
      tx.order.findUnique.mockResolvedValue(
        orderRow({
          user: { id: 'u-1', email: 'b@x.com', firstName: 'Ada' },
          orderItems: [
            {
              productId: 'p1',
              variantId: null,
              quantity: 2,
              vendorId: 'v-1',
              unitPrice: D(50),
              totalPrice: D(100),
              product: { name: 'Red Shoe' },
              variant: null,
              vendor: { id: 'v-1', email: 'v@shop.com', storeName: 'Shop' },
            },
          ],
        }),
      );

      await go(OrderStatus.SHIPPED);

      expect(runner.emitted).toEqual([
        expect.objectContaining({
          aggregateType: 'order',
          aggregateId: 'ord-1',
          payload: expect.objectContaining({
            userId: 'u-1',
            dedupeKey: 'ORDER_SHIPPED:ord-1:USER:u-1',
          }),
        }),
      ]);
      expect(runner.published.map((e) => e.type)).toEqual(['order.shipped']);
    });
  });

  describe('cancelling', () => {
    it('refuses to cancel a paid order: it must go through a refund', async () => {
      tx.order.findUnique.mockResolvedValue(
        orderRow({
          status: OrderStatus.PENDING,
          payment: { id: 'pay-1', status: PaymentStatus.SUCCESS },
        }),
      );

      await expect(go(OrderStatus.CANCELLED)).rejects.toThrow(
        /refund workflow/,
      );
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it('puts the stock back once, hands back the discount and fails the unpaid payment', async () => {
      tx.order.findUnique.mockResolvedValue(
        orderRow({
          status: OrderStatus.PENDING,
          payment: { id: 'pay-1', status: PaymentStatus.PENDING },
        }),
      );

      await go(OrderStatus.CANCELLED);

      expect(tx.stockHistory.createMany).toHaveBeenCalledTimes(1);
      expect(tx.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-1' },
        data: { stockRestored: true },
      });
      expect(funding.releaseDiscountUsage).toHaveBeenCalledWith(tx, 'ord-1');
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: PaymentStatus.FAILED },
      });
    });

    it('does not put stock back twice', async () => {
      tx.order.findUnique.mockResolvedValue(
        orderRow({ status: OrderStatus.PENDING, stockRestored: true }),
      );

      await go(OrderStatus.CANCELLED);

      expect(tx.stockHistory.createMany).not.toHaveBeenCalled();
      expect(tx.order.update).not.toHaveBeenCalled();
    });
  });

  describe('delivering', () => {
    beforeEach(() => {
      tx.order.findUnique.mockResolvedValue(
        orderRow({
          status: OrderStatus.SHIPPED,
          orderItems: [
            {
              productId: 'p1',
              variantId: null,
              quantity: 1,
              vendorId: 'v-1',
              unitPrice: D(100),
              totalPrice: D(100),
            },
            {
              productId: 'p2',
              variantId: null,
              quantity: 1,
              vendorId: 'v-2',
              unitPrice: D(100),
              totalPrice: D(100),
            },
          ],
        }),
      );
    });

    it('settles exactly what was credited at payment time, inside the same transaction', async () => {
      (funding.loadCreditedVendorEarnings as jest.Mock).mockResolvedValue(
        new Map([
          ['v-1', D(85)],
          ['v-2', D(70)],
        ]),
      );

      await go(OrderStatus.DELIVERED);

      expect(wallet.settleVendorEarning).toHaveBeenCalledWith(
        'v-1',
        D(85),
        'ord-1',
        tx,
      );
      expect(wallet.settleVendorEarning).toHaveBeenCalledWith(
        'v-2',
        D(70),
        'ord-1',
        tx,
      );
    });

    it('falls back to the computed earning for a vendor with no ledger entry, and skips a zero one', async () => {
      (funding.loadCreditedVendorEarnings as jest.Mock).mockResolvedValue(
        new Map([['v-2', D(0)]]),
      );

      await go(OrderStatus.DELIVERED);

      const settled = wallet.settleVendorEarning.mock.calls.map((c) => c[0]);
      expect(settled).toEqual(['v-1']);
      expect(wallet.settleVendorEarning.mock.calls[0][1]).toEqual(
        expect.any(Prisma.Decimal),
      );
    });

    it('settles nobody when the order is only shipped', async () => {
      tx.order.findUnique.mockResolvedValue(orderRow());

      await go(OrderStatus.SHIPPED);

      expect(wallet.settleVendorEarning).not.toHaveBeenCalled();
    });
  });

  describe('the status event', () => {
    const eventRow = {
      id: 'ord-1',
      orderNumber: 'ORD-1',
      userId: 'u-1',
      user: { id: 'u-1', email: 'buyer@example.com', firstName: 'Ada' },
      orderItems: [
        {
          quantity: 2,
          unitPrice: 50,
          totalPrice: 100,
          product: { name: 'Red Shoe' },
          variant: null,
          vendor: { id: 'v-1', email: 'v@shop.com', storeName: 'Shop' },
        },
      ],
    };
    /** Runs the publisher in its own transaction and returns what it published. */
    const published = async (
      status: OrderStatus,
      userId: string | undefined,
    ) => {
      const fake = new FakeTransactionRunner(tx);
      await fake.run(
        (ctx) =>
          (service as any).publishStatusChangeEvent(
            ctx,
            'ord-1',
            status,
            userId,
          ),
        { name: 't' },
      );
      return fake.published as unknown as Array<{
        type: string;
        aggregate: unknown;
        payload: unknown;
      }>;
    };

    it.each([
      [OrderStatus.SHIPPED, 'order.shipped'],
      [OrderStatus.DELIVERED, 'order.delivered'],
      [OrderStatus.CANCELLED, 'order.cancelled'],
    ])(
      'publishes %s as %s, reading through the transaction',
      async (status, type) => {
        tx.order.findUnique.mockResolvedValue(eventRow);

        const events = await published(status, 'u-1');

        expect(tx.order.findUnique).toHaveBeenCalledTimes(1);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          type,
          aggregate: { type: 'order', id: 'ord-1' },
          payload: expect.objectContaining({
            orderId: 'ord-1',
            userEmail: 'buyer@example.com',
            items: [
              expect.objectContaining({ productName: 'Red Shoe', quantity: 2 }),
            ],
          }),
        });
      },
    );

    it('publishes nothing for a status with no event (PROCESSING comes from payment)', async () => {
      tx.order.findUnique.mockResolvedValue(eventRow);

      expect(await published(OrderStatus.PROCESSING, 'u-1')).toHaveLength(0);
    });

    it('publishes nothing when the order has no customer', async () => {
      tx.order.findUnique.mockResolvedValue({ ...eventRow, user: null });
      expect(await published(OrderStatus.SHIPPED, 'u-1')).toHaveLength(0);

      tx.order.findUnique.mockResolvedValue(eventRow);
      expect(await published(OrderStatus.SHIPPED, undefined)).toHaveLength(0);
    });
  });
});
