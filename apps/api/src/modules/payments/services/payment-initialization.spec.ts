import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';

describe('PaymentsService.initializeForOrder', () => {
  let prisma: any;
  let paystack: { assertConfigured: jest.Mock; post: jest.Mock };
  let confirmation: { confirm: jest.Mock };
  let service: PaymentsService;

  const payment = (over: Record<string, unknown> = {}, order: object = {}) => ({
    id: 'pay-1',
    amount: new Prisma.Decimal(5000),
    status: PaymentStatus.PENDING,
    currency: 'ngn',
    transactionReference: null,
    paymentLink: null,
    order: {
      id: 'ord-1',
      orderNumber: 'ORD-1',
      userId: 'u-1',
      status: OrderStatus.PENDING,
      ...order,
    },
    user: { email: 'a@b.com' },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(payment()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    paystack = { assertConfigured: jest.fn(), post: jest.fn() };
    confirmation = { confirm: jest.fn().mockResolvedValue(null) };
    service = new PaymentsService(
      prisma,
      { assertActiveAccount: jest.fn() } as never,
      { get: jest.fn().mockReturnValue('') } as never,
      {} as never,
      {} as never,
      paystack as never,
      {} as never,
      {} as never,
      {} as never,
      confirmation as never,
    );
  });

  it('answers a retry with the link and reference already stored, without asking Paystack again', async () => {
    prisma.payment.findUnique.mockResolvedValue(
      payment({
        transactionReference: 'nuts_ref',
        paymentLink: 'https://paystack/pay/abc',
      }),
    );

    const result = await service.initializeForOrder('u-1', 'ord-1');

    expect(result).toEqual({
      authorizationUrl: 'https://paystack/pay/abc',
      reference: 'nuts_ref',
      paymentId: 'pay-1',
    });
    expect(paystack.post).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('only lets the order’s own customer start the payment', async () => {
    await expect(
      service.initializeForOrder('someone-else', 'ord-1'),
    ).rejects.toThrow(NotFoundException);

    prisma.payment.findUnique.mockResolvedValue(null);
    await expect(service.initializeForOrder('u-1', 'nope')).rejects.toThrow(
      NotFoundException,
    );
    expect(paystack.post).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a cancelled order',
      payment({}, { status: OrderStatus.CANCELLED }),
      /cancelled/,
    ],
    [
      'a refunded order',
      payment({}, { status: OrderStatus.REFUNDED }),
      /refunded/,
    ],
    [
      'an order being refunded',
      payment({}, { status: OrderStatus.REFUND_PENDING }),
      /refund is already being processed/,
    ],
    [
      'a payment being refunded',
      payment({ status: PaymentStatus.REFUND_PENDING }),
      /refund is already being processed/,
    ],
    [
      'an order already paid',
      payment({ status: PaymentStatus.SUCCESS }),
      /already paid/,
    ],
    [
      'a payment already refunded',
      payment({ status: PaymentStatus.REFUNDED }),
      /already been refunded/,
    ],
  ])('refuses to start a payment for %s', async (_label, row, message) => {
    prisma.payment.findUnique.mockResolvedValue(row);

    await expect(service.initializeForOrder('u-1', 'ord-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.initializeForOrder('u-1', 'ord-1')).rejects.toThrow(
      message,
    );
    expect(paystack.post).not.toHaveBeenCalled();
  });

  it('settles an order that costs nothing without Paystack, under one stable reference', async () => {
    prisma.payment.findUnique
      .mockResolvedValueOnce(payment({ amount: new Prisma.Decimal(0) }))
      .mockResolvedValueOnce({ transactionReference: 'FREE-stored' });

    const result = await service.initializeForOrder('u-1', 'ord-1');

    expect(paystack.post).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pay-1',
        status: PaymentStatus.PENDING,
        transactionReference: null,
      },
      data: {
        transactionReference: expect.stringMatching(/^FREE-/),
        paymentMethod: 'discount',
      },
    });
    expect(confirmation.confirm).toHaveBeenCalledWith(
      'FREE-stored',
      undefined,
      'ord-1',
      true,
    );
    expect(result).toMatchObject({
      reference: 'FREE-stored',
      paymentId: 'pay-1',
    });
  });

  it('does not rewrite the reference of a free order that already has one', async () => {
    prisma.payment.findUnique
      .mockResolvedValueOnce(
        payment({
          amount: new Prisma.Decimal(0),
          transactionReference: 'FREE-old',
        }),
      )
      .mockResolvedValueOnce({ transactionReference: 'FREE-old' });

    await service.initializeForOrder('u-1', 'ord-1');

    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(confirmation.confirm).toHaveBeenCalledWith(
      'FREE-old',
      undefined,
      'ord-1',
      true,
    );
  });
});
