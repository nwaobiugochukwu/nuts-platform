import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { InsufficientStockException } from '@api/common/errors/insufficient-stock.exception';
import { FakeTransactionRunner } from '@api/infrastructure/database/fake-transaction-runner-spec';
import { CART_CACHE_PREFIX } from '@api/modules/cart/services/cart.service';
import { OrderCheckoutService } from '../services/order-checkout.service';

const D = (n: number) => new Prisma.Decimal(n);

describe('OrderCheckoutService', () => {
  let prisma: any;
  let tx: any;
  let runner: FakeTransactionRunner;
  let users: { assertActiveAccount: jest.Mock };
  let discounts: {
    resolveVoucherStack: jest.Mock;
    recordUsage: jest.Mock;
  };
  let firstOrder: { invalidate: jest.Mock };
  let payments: { initializeForOrder: jest.Mock };
  let cache: { del: jest.Mock };
  let service: OrderCheckoutService;
  /** Stock left per inventory id; absent means none. */
  let stock: Record<string, number>;

  const config = (revalidate = 'true') => ({
    getOrThrow: (key: string) =>
      key === 'CHECKOUT_REVALIDATE_PRICES' ? revalidate : ' NGN ',
  });

  const line = (over: Record<string, any> = {}) => ({
    id: 'ci-1',
    productId: 'p1',
    variantId: null,
    quantity: 2,
    unitPrice: D(1000),
    totalPrice: D(2000),
    recommendationContext: null,
    product: {
      id: 'p1',
      name: 'Red Shoe',
      sku: 'SKU-1',
      price: D(1000),
      isActive: true,
      isDeleted: false,
      vendorId: 'v-1',
      categoryId: 'c-1',
      category: { parentId: null },
      images: [{ url: 'https://img/1.png' }],
    },
    variant: null,
    ...over,
  });
  const cartOf = (items: any[] = [line()], over: object = {}) => ({
    id: 'cart-1',
    checkedOut: false,
    deliveryCharge: D(500),
    serviceCharge: D(100),
    cartItems: items,
    ...over,
  });

  const inline = {
    shippingAddress: {
      fullName: 'Jane Doe',
      phone: '0800',
      street: '1 Main St',
      city: 'Lagos',
      state: 'Lagos',
    },
  } as any;

  const placedOrder = (over: object = {}) => ({
    id: 'ord-1',
    orderNumber: 'ORD-1',
    status: OrderStatus.PENDING,
    totalAmount: D(2000),
    discountAmount: D(0),
    referralDiscountAmount: D(0),
    finalAmount: D(2600),
    discountCode: null,
    referralCode: null,
    shippingAddress: 'x',
    createdAt: new Date(),
    orderItems: [],
    payment: { id: 'pay-1', status: PaymentStatus.PENDING },
    ...over,
  });

  beforeEach(() => {
    stock = { p1: 10, 'var-1': 10, p2: 10 };
    tx = {
      $queryRaw: jest.fn((sql: Prisma.Sql) => {
        const text = sql.strings.join('?');
        if (text.includes('FROM "carts"'))
          return Promise.resolve([{ id: 'cart-1' }]);
        const id = sql.values.find((v) => typeof v === 'string') as string;
        const qty = sql.values.find((v) => typeof v === 'number') as number;
        if (text.includes('UPDATE')) {
          if ((stock[id] ?? 0) < qty) return Promise.resolve([]);
          stock[id] -= qty;
          return Promise.resolve([
            {
              id,
              productId: 'p1',
              oldStock: stock[id] + qty,
              newStock: stock[id],
            },
          ]);
        }
        return Promise.resolve([]);
      }),
      checkoutIdempotency: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      cart: {
        findMany: jest.fn().mockResolvedValue([cartOf()]),
        deleteMany: jest.fn(),
        update: jest.fn(),
      },
      cartItem: { update: jest.fn(), deleteMany: jest.fn() },
      shippingAddress: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'addr-new',
          fullName: 'Jane Doe',
          phone: '0800',
          street: '1 Main St',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
        }),
      },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'ord-1' }),
        findUnique: jest.fn().mockResolvedValue(placedOrder()),
      },
      orderItem: { createMany: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
      payment: { create: jest.fn() },
      stockHistory: { createMany: jest.fn() },
      product: { findUnique: jest.fn() },
      productVariant: { findUnique: jest.fn() },
    };
    prisma = {
      checkoutIdempotency: { findUnique: jest.fn() },
      order: { findUnique: jest.fn() },
    };
    runner = new FakeTransactionRunner(tx);
    users = { assertActiveAccount: jest.fn().mockResolvedValue(undefined) };
    discounts = {
      resolveVoucherStack: jest
        .fn()
        .mockResolvedValue({ applied: [], totalDiscount: D(0) }),
      recordUsage: jest.fn().mockResolvedValue(undefined),
    };
    firstOrder = { invalidate: jest.fn().mockResolvedValue(undefined) };
    payments = {
      initializeForOrder: jest.fn().mockResolvedValue({
        authorizationUrl: 'https://paystack/auth',
        accessCode: 'acc',
        reference: 'ref-1',
        paymentId: 'pay-1',
      }),
    };
    cache = { del: jest.fn().mockResolvedValue(undefined) };
    service = new OrderCheckoutService(
      prisma,
      runner as never,
      users as never,
      discounts as never,
      firstOrder as never,
      payments as never,
      config() as never,
      cache as never,
    );
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  const checkout = (dto: any = inline, addressId?: string, key = 'key-1') =>
    service.checkout('u-1', dto, addressId, key);

  describe('what the request must carry', () => {
    it.each([
      ['a blank idempotency key', {}, 'addr-1', ''],
      ['an idempotency key over 255 characters', {}, 'addr-1', 'a'.repeat(256)],
    ])('refuses %s', async (_l, dto, addr, key) => {
      await expect(checkout(dto, addr, key)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a request with no address', async () => {
      await expect(checkout({}, undefined)).rejects.toThrow(
        'A shipping address is required.',
      );
    });

    it('refuses a request with both a saved and an inline address', async () => {
      await expect(checkout(inline, 'addr-1')).rejects.toThrow(
        'Provide either addressId or shippingAddress, not both.',
      );
    });

    it('checks the account is active first', async () => {
      users.assertActiveAccount.mockRejectedValue(new Error('blocked'));

      await expect(checkout()).rejects.toThrow('blocked');
      expect(runner.runs).toHaveLength(0);
    });
  });

  describe('placing an order', () => {
    it('writes the order, its lines, history, payment, idempotency record and consumes the cart, in one transaction', async () => {
      const response = await checkout();

      expect(runner.runs).toEqual(['order.checkout']);
      expect(tx.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u-1',
          cartId: 'cart-1',
          status: OrderStatus.PENDING,
          totalAmount: D(2000),
          discountAmount: D(0),
          // goods 2000 + delivery 500 + service 100
          finalAmount: D(2600),
          discountCode: null,
          shippingAddressId: 'addr-new',
          orderNumber: expect.stringMatching(/^ORD-\d{8}-[A-Z0-9]{8}$/),
        }),
      });
      expect(tx.orderItem.createMany.mock.calls[0][0].data).toEqual([
        expect.objectContaining({
          orderId: 'ord-1',
          productId: 'p1',
          vendorId: 'v-1',
          quantity: 2,
          unitPrice: D(1000),
          totalPrice: D(2000),
          productSnapshot: {
            name: 'Red Shoe',
            sku: 'SKU-1',
            images: ['https://img/1.png'],
          },
        }),
      ]);
      expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          toStatus: OrderStatus.PENDING,
          note: 'Order placed',
        }),
      });
      expect(tx.payment.create).toHaveBeenCalledWith({
        data: {
          amount: D(2600),
          status: PaymentStatus.PENDING,
          currency: 'ngn',
          userId: 'u-1',
          orderId: 'ord-1',
        },
      });
      expect(tx.checkoutIdempotency.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u-1',
          idempotencyKey: 'key-1',
          orderId: 'ord-1',
        }),
      });
      expect(tx.cart.update).toHaveBeenCalledWith({
        where: { id: 'cart-1' },
        data: { checkedOut: true },
      });
      expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'cart-1' },
      });
      expect(response).toMatchObject({
        id: 'ord-1',
        authorizationUrl: 'https://paystack/auth',
        paymentId: 'pay-1',
        paystackAccessCode: 'acc',
        paymentReference: 'ref-1',
      });
    });

    it('takes the stock and records it, and creates an address typed in at checkout', async () => {
      await checkout();

      expect(stock.p1).toBe(8);
      expect(tx.stockHistory.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            productId: 'p1',
            adjustment: -2,
            description: 'Stock deducted during checkout',
          }),
        ],
      });
      expect(tx.shippingAddress.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u-1',
          country: 'Nigeria',
          isDefault: false,
        }),
        select: expect.any(Object),
      });
    });

    it('uses a saved address only if it belongs to the shopper', async () => {
      tx.shippingAddress.findFirst.mockResolvedValue({
        id: 'addr-1',
        fullName: 'Jane',
        phone: '0800',
        street: '1 St',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
      });

      await checkout({}, 'addr-1');

      expect(tx.shippingAddress.findFirst).toHaveBeenCalledWith({
        where: { id: 'addr-1', userId: 'u-1' },
        select: expect.any(Object),
      });
      expect(tx.shippingAddress.create).not.toHaveBeenCalled();
      expect(tx.order.create.mock.calls[0][0].data.shippingAddress).toContain(
        '(Tel: 0800)',
      );
    });

    it('refuses an address that is not the shopper’s, and places nothing', async () => {
      tx.shippingAddress.findFirst.mockResolvedValue(null);

      await expect(checkout({}, 'addr-x')).rejects.toThrow(NotFoundException);
      expect(tx.order.create).not.toHaveBeenCalled();
    });

    it('clears the cart cache and the first-order promo cache only after commit', async () => {
      let whenCleared = -1;
      cache.del.mockImplementation(() => {
        whenCleared = tx.checkoutIdempotency.create.mock.calls.length;
        return Promise.resolve();
      });

      await checkout();

      expect(cache.del).toHaveBeenCalledWith(`${CART_CACHE_PREFIX}u-1`);
      expect(firstOrder.invalidate).toHaveBeenCalledWith('u-1');
      expect(whenCleared).toBe(1);
    });

    it('still gives the order when the payment link cannot be made yet', async () => {
      payments.initializeForOrder.mockRejectedValue(new Error('paystack down'));

      const response = await checkout();

      expect(response.id).toBe('ord-1');
      expect(response.authorizationUrl).toBeUndefined();
    });
  });

  describe('the cart', () => {
    it.each([
      [
        'has no active cart',
        () => tx.$queryRaw.mockResolvedValue([]),
        /empty or has already/,
      ],
      [
        'has an empty cart',
        () => tx.cart.findMany.mockResolvedValue([cartOf([])]),
        /Your cart is empty/,
      ],
      [
        'has a product that was removed',
        () =>
          tx.cart.findMany.mockResolvedValue([
            cartOf([line({ product: { ...line().product, isDeleted: true } })]),
          ]),
        /no longer available/,
      ],
      [
        'has a product with no vendor',
        () =>
          tx.cart.findMany.mockResolvedValue([
            cartOf([line({ product: { ...line().product, vendorId: null } })]),
          ]),
        /no vendor assignment/,
      ],
      [
        'has a variant that was removed',
        () =>
          tx.cart.findMany.mockResolvedValue([
            cartOf([
              line({
                variantId: 'var-1',
                variant: {
                  id: 'var-1',
                  options: [],
                  stock: 5,
                  isActive: false,
                  isDeleted: false,
                },
              }),
            ]),
          ]),
        /variant .* no longer available/,
      ],
      [
        'has a zero quantity line',
        () =>
          tx.cart.findMany.mockResolvedValue([cartOf([line({ quantity: 0 })])]),
        /Invalid quantity/,
      ],
    ])(
      'refuses when the shopper %s, changing nothing',
      async (_l, arrange, message) => {
        arrange();

        await expect(checkout()).rejects.toThrow(message);
        expect(tx.order.create).not.toHaveBeenCalled();
        expect(tx.stockHistory.createMany).not.toHaveBeenCalled();
      },
    );

    it('buys the cart that has items and deletes the empty duplicates', async () => {
      tx.cart.findMany.mockResolvedValue([
        { ...cartOf([]), id: 'cart-empty' },
        cartOf(),
      ]);
      tx.$queryRaw.mockImplementationOnce(() =>
        Promise.resolve([{ id: 'cart-empty' }, { id: 'cart-1' }]),
      );

      await checkout();

      expect(tx.cart.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['cart-empty'] } },
      });
      expect(tx.order.create.mock.calls[0][0].data.cartId).toBe('cart-1');
    });
  });

  describe('prices', () => {
    const repriced = () =>
      tx.cart.findMany.mockResolvedValue([
        cartOf([
          line({
            unitPrice: D(900),
            totalPrice: D(1800),
            product: { ...line().product, price: D(1000) },
          }),
        ]),
      ]);

    it('charges the live price when the product’s price changed since it was added', async () => {
      repriced();

      await checkout();

      expect(tx.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'ci-1' },
        data: { unitPrice: D(1000), totalPrice: D(2000) },
      });
      expect(tx.order.create.mock.calls[0][0].data.totalAmount).toEqual(
        D(2000),
      );
    });

    it('keeps the cart’s price when price revalidation is switched off', async () => {
      service = new OrderCheckoutService(
        prisma,
        runner as never,
        users as never,
        discounts as never,
        firstOrder as never,
        payments as never,
        config('false') as never,
        cache as never,
      );
      repriced();

      await checkout();

      expect(tx.cartItem.update).not.toHaveBeenCalled();
      expect(tx.order.create.mock.calls[0][0].data.totalAmount).toEqual(
        D(1800),
      );
    });
  });

  describe('vouchers', () => {
    const applied = (id: string, code: string, amount: number) => ({
      discount: { id, code },
      discountAmount: D(amount),
    });

    it('takes the discount off the goods only, records each voucher’s usage in a fixed order, and names the codes', async () => {
      discounts.resolveVoucherStack.mockResolvedValue({
        applied: [
          applied('b-2', 'PLAT10', 100),
          applied('a-1', 'STORE20', 400),
        ],
        totalDiscount: D(500),
      });

      await checkout({ ...inline, discountCodes: ['STORE20', 'PLAT10'] });

      expect(discounts.resolveVoucherStack).toHaveBeenCalledWith(
        ['STORE20', 'PLAT10'],
        'u-1',
        [
          expect.objectContaining({
            productId: 'p1',
            vendorId: 'v-1',
            categoryIds: ['c-1'],
            lineTotal: D(2000),
            quantity: 2,
          }),
        ],
        { strict: true, includeAutomatic: true },
      );
      const data = tx.order.create.mock.calls[0][0].data;
      expect(data.discountAmount).toEqual(D(500));
      expect(data.discountCode).toBe('PLAT10, STORE20');
      // (2000 - 500) + 500 delivery + 100 service
      expect(data.finalAmount).toEqual(D(2100));
      expect(discounts.recordUsage.mock.calls.map((c) => c[0])).toEqual([
        'a-1',
        'b-2',
      ]);
      expect(discounts.recordUsage).toHaveBeenCalledWith(
        'a-1',
        'ord-1',
        'u-1',
        D(400),
        tx,
      );
    });

    it('merges the older single code with the list, trimmed, and ignores blanks', async () => {
      await checkout({
        ...inline,
        discountCodes: [' A ', ''],
        discountCode: 'B',
      });

      expect(discounts.resolveVoucherStack.mock.calls[0][0]).toEqual([
        'A',
        'B',
      ]);
    });

    it('never charges less than the delivery and service charges', async () => {
      discounts.resolveVoucherStack.mockResolvedValue({
        applied: [applied('a-1', 'BIG', 5000)],
        totalDiscount: D(5000),
      });

      await checkout();

      expect(tx.order.create.mock.calls[0][0].data.finalAmount).toEqual(D(600));
    });

    it('records no voucher usage when none applied', async () => {
      await checkout();

      expect(discounts.recordUsage).not.toHaveBeenCalled();
    });
  });

  describe('stock', () => {
    it('reports every line that is short, in one response, and takes nothing', async () => {
      stock.p1 = 1;
      stock.p2 = 0;
      tx.cart.findMany.mockResolvedValue([
        cartOf([
          line(),
          line({
            id: 'ci-2',
            productId: 'p2',
            product: { ...line().product, id: 'p2', name: 'Blue Shoe' },
          }),
        ]),
      ]);
      tx.product.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve({
          stock: stock[where.id],
          isActive: true,
          isDeleted: false,
        }),
      );

      const error = await checkout().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InsufficientStockException);
      expect(tx.order.create).not.toHaveBeenCalled();
      expect(tx.stockHistory.createMany).not.toHaveBeenCalled();
      const detail = JSON.stringify((error as any).getResponse());
      expect(detail).toContain('Red Shoe');
      expect(detail).toContain('Blue Shoe');
    });

    it('takes stock for variants against the variant row', async () => {
      tx.cart.findMany.mockResolvedValue([
        cartOf([
          line({
            variantId: 'var-1',
            variant: {
              id: 'var-1',
              options: [{ name: 'Size', value: 'M' }],
              stock: 10,
              isActive: true,
              isDeleted: false,
            },
          }),
        ]),
      ]);

      await checkout();

      expect(stock['var-1']).toBe(8);
      expect(tx.stockHistory.createMany.mock.calls[0][0].data[0]).toMatchObject(
        {
          productId: 'p1',
          variantId: 'var-1',
        },
      );
    });
  });

  describe('a repeated request', () => {
    const existing = () => ({
      orderId: 'ord-100',
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    it('returns the order already placed under the key, creating nothing', async () => {
      tx.checkoutIdempotency.findUnique.mockResolvedValue(existing());
      tx.order.findUnique.mockResolvedValue(placedOrder({ id: 'ord-100' }));

      const result = await checkout();

      expect(result.id).toBe('ord-100');
      expect(tx.order.create).not.toHaveBeenCalled();
      expect(tx.stockHistory.createMany).not.toHaveBeenCalled();
    });

    it('treats the other request’s win of a simultaneous race as the answer', async () => {
      const race = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
      jest.spyOn(runner, 'run').mockRejectedValue(race);
      prisma.checkoutIdempotency.findUnique.mockResolvedValue(existing());
      prisma.order.findUnique.mockResolvedValue(placedOrder({ id: 'ord-100' }));

      const result = await checkout();

      expect(result.id).toBe('ord-100');
    });

    it('asks the shopper to retry when the race left no usable record', async () => {
      const race = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
      jest.spyOn(runner, 'run').mockRejectedValue(race);
      prisma.checkoutIdempotency.findUnique.mockResolvedValue({
        orderId: 'ord-100',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(checkout()).rejects.toThrow(ConflictException);
    });

    it('lets any other failure through', async () => {
      jest.spyOn(runner, 'run').mockRejectedValue(new Error('db down'));

      await expect(checkout()).rejects.toThrow('db down');
      expect(payments.initializeForOrder).not.toHaveBeenCalled();
    });
  });
});
