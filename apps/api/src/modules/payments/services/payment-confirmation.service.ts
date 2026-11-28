import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  NotificationPriority,
  NotificationType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ROLE,
} from '@prisma/client';
import { VENDOR_COMMISSION_RATE } from '@api/common/constants/commission.constants';
import { PAYSTACK_SUCCESS_STATUS } from '@api/common/constants/payment.constants';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import {
  TransactionRunnerService,
  type TransactionContext,
} from '@api/infrastructure/database/transaction-runner.service';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import type {
  OrderProcessingPayload,
  PaymentConfirmedPayload,
  PaymentFailedPayload,
} from '@api/infrastructure/messaging/events/event-payloads.types';
import { RABBITMQ_ROUTING_KEYS } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { CART_CACHE_PREFIX } from '@api/modules/cart/services/cart.service';
import {
  computeVendorEarnings,
  loadVendorFundedDiscounts,
} from '@api/modules/discounts/utils/discount-funding.util';
import { generateStatusNote } from '@api/modules/orders/constants/order-status.constants';
import { WalletService } from '@api/modules/wallets/services/wallet.service';
import type { PaymentResponseDto } from '../dto/payment-response.dto';
import type { PaystackWebhookEvent } from '../types/paystack.types';
import { toPaystackAmount } from '../utils/payment-money.util';
import { toPaymentResponse } from '../utils/payment-response.util';
import { PaystackClientService } from './paystack-client.service';

/**
 * Turns a provider's "the customer paid" into the local facts, exactly once: the payment becomes
 * SUCCESS, the order starts processing, the vendors' earnings are credited as pending, and the
 * events and notices that follow are written in the same transaction. The payment's
 * PENDING to SUCCESS change is the concurrency gate: of two deliveries of the same charge only one
 * wins it and the other changes nothing.
 */
@Injectable()
export class PaymentConfirmationService {
  private readonly logger = new Logger(PaymentConfirmationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRunnerService,
    private readonly paystack: PaystackClientService,
    private readonly walletService: WalletService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  /**
   * Confirms a payment by its provider reference. Returns the payment, or null when it cannot be
   * confirmed (unknown, not paid, or the amount or currency does not match what we asked for).
   */
  async confirm(
    reference: string,
    webhookData?: PaystackWebhookEvent['data'],
    orderIdFallback?: string,
    zeroTotal = false,
  ): Promise<PaymentResponseDto | null> {
    /**
     * transactionReference is @unique in Prisma.
     * If not found by reference directly, fallback to orderId if available.
     */
    let payment = await this.prisma.payment.findUnique({
      where: {
        transactionReference: reference,
      },
    });

    if (!payment && orderIdFallback) {
      payment = await this.prisma.payment.findFirst({
        where: {
          orderId: orderIdFallback,
        },
      });
    }

    if (!payment) {
      return null;
    }

    if (payment.status === PaymentStatus.SUCCESS) {
      return toPaymentResponse(payment);
    }

    if (payment.status === PaymentStatus.REFUNDED) {
      return toPaymentResponse(payment);
    }

    if (payment.status === PaymentStatus.REFUND_PENDING) {
      return toPaymentResponse(payment);
    }

    const charge = await this.verifyCharge(
      payment,
      reference,
      webhookData,
      zeroTotal,
    );
    if (!charge) return null;

    const { updated, orderMovedToProcessing } = await this.settle(
      payment,
      charge.chargeId,
      reference,
    );

    if (!orderMovedToProcessing) {
      this.logger.error(
        `Payment ${updated.id} was captured but order ${payment.orderId} did not move from PENDING to PROCESSING. Vendor earnings were not credited; reconciliation is required.`,
      );
    }

    return toPaymentResponse(updated);
  }

  /**
   * Never trust unverified payload amounts directly: ask Paystack to verify the transaction. If
   * that call times out or is unreachable but we hold a signed webhook proving charge.success, use
   * the webhook. Returns null (marking the payment FAILED when the provider says it failed or the
   * amount or currency is wrong) unless the charge is confirmed for the amount we expect.
   */
  private async verifyCharge(
    payment: Prisma.PaymentGetPayload<object>,
    reference: string,
    webhookData: PaystackWebhookEvent['data'] | undefined,
    zeroTotal: boolean,
  ): Promise<{ chargeId: string } | null> {
    // A zero-total order has no provider transaction to verify. This branch
    // is gated on the stored amount being zero, never on caller input alone.
    let verified =
      zeroTotal && new Prisma.Decimal(payment.amount).isZero()
        ? ({
            status: true,
            message: 'No charge required (zero-total order)',
            data: {
              status: PAYSTACK_SUCCESS_STATUS,
              reference,
              amount: 0,
              currency: payment.currency,
              paid_at: new Date().toISOString(),
            },
          } as Awaited<ReturnType<PaystackClientService['verifyTransaction']>>)
        : await this.paystack.verifyTransaction(reference);

    if (
      (!verified?.status ||
        !verified.data ||
        verified.data.status !== PAYSTACK_SUCCESS_STATUS) &&
      webhookData &&
      (webhookData.status === PAYSTACK_SUCCESS_STATUS ||
        webhookData.status === 'success')
    ) {
      this.logger.log(
        `Paystack verification API returned non-success or timed out; utilizing cryptographically signed webhook data for reference ${reference}.`,
      );
      verified = {
        status: true,
        message: 'Verified via cryptographically signed webhook payload',
        data: {
          id: typeof webhookData.id === 'number' ? webhookData.id : undefined,
          status: PAYSTACK_SUCCESS_STATUS,
          reference: webhookData.reference ?? reference,
          amount: Number(webhookData.amount),
          currency: webhookData.currency ?? payment.currency,
          paid_at: webhookData.paid_at ?? new Date().toISOString(),
        },
      };
    }

    if (
      !verified?.status ||
      !verified.data ||
      verified.data.status !== PAYSTACK_SUCCESS_STATUS
    ) {
      if (verified?.data?.status === 'failed') {
        await this.prisma.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PENDING,
          },
          data: {
            status: PaymentStatus.FAILED,
          },
        });
      }

      return null;
    }

    const expectedAmount = toPaystackAmount(payment.amount);

    const receivedCurrency = verified.data.currency?.toUpperCase();

    const expectedCurrency = payment.currency.toUpperCase();

    if (
      verified.data.amount !== expectedAmount ||
      (receivedCurrency && receivedCurrency !== expectedCurrency)
    ) {
      this.logger.error(
        `Paystack verification mismatch for ${reference}. Expected ${expectedAmount} ${expectedCurrency}; received ${verified.data.amount} ${receivedCurrency}`,
      );

      await this.prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.PENDING,
        },
        data: {
          status: PaymentStatus.FAILED,
        },
      });

      return null;
    }

    return { chargeId: String(verified.data.id ?? reference) };
  }

  /** The one transaction that records a confirmed charge. */
  private async settle(
    payment: Prisma.PaymentGetPayload<object>,
    chargeId: string,
    reference: string,
  ): Promise<{
    updated: Prisma.PaymentGetPayload<object>;
    orderMovedToProcessing: boolean;
  }> {
    const { updated, orderMovedToProcessing } = await this.transactions.run(
      async (ctx) => {
        const tx = ctx.tx;
        let orderMovedToProcessing = false;
        const claimed = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PENDING,
          },
          data: {
            status: PaymentStatus.SUCCESS,

            transactionId: chargeId,

            paymentMethod: 'paystack',
          },
        });

        if (claimed.count === 0) {
          /**
           * Another webhook/callback already processed this payment.
           */
          const currentPayment = await tx.payment.findUniqueOrThrow({
            where: {
              id: payment.id,
            },
          });

          if (
            currentPayment.status !== PaymentStatus.SUCCESS &&
            currentPayment.status !== PaymentStatus.REFUNDED
          ) {
            const currentOrder = await tx.order.findUnique({
              where: { id: payment.orderId },
              select: { status: true },
            });
            await ctx.audit({
              action: 'PAYMENT_CAPTURED_AFTER_PAYMENT_TERMINAL',
              entity: 'PAYMENT',
              entityId: payment.id,
              userId: payment.userId,
              payload: {
                orderId: payment.orderId,
                paymentStatus: currentPayment.status,
                orderStatus: currentOrder?.status ?? null,
                amount: Number(payment.amount),
                currency: payment.currency,
                reference,
                settlementRequiresReview: true,
              },
            });
          }

          return { updated: currentPayment, orderMovedToProcessing: false };
        }

        /**
         * Payment succeeded.
         *
         * Move order from PENDING -> PROCESSING atomically.
         */
        const orderUpdated = await tx.order.updateMany({
          where: {
            id: payment.orderId,
            status: OrderStatus.PENDING,
          },
          data: {
            status: OrderStatus.PROCESSING,
          },
        });

        if (orderUpdated.count === 1) {
          orderMovedToProcessing = true;

          await tx.orderStatusHistory.create({
            data: {
              orderId: payment.orderId,

              fromStatus: OrderStatus.PENDING,

              toStatus: OrderStatus.PROCESSING,

              note: generateStatusNote({
                fromStatus: OrderStatus.PENDING,

                toStatus: OrderStatus.PROCESSING,
              }),
            },
          });

          /**
           * The cart was already marked checkedOut during order creation.
           *
           * We therefore do NOT delete cart items here.
           *
           * This keeps payment confirmation idempotent and avoids destroying
           * data unnecessarily.
           */
        }

        /**
         * Vendor earnings are credited exactly once because only the
         * transaction that successfully changed payment PENDING -> SUCCESS
         * reaches this point.
         */
        const order = await tx.order.findUnique({
          where: {
            id: payment.orderId,
          },
          select: {
            orderNumber: true,
            status: true,
            orderItems: {
              select: {
                productId: true,
                vendorId: true,
                quantity: true,
                unitPrice: true,
                recommendationContext: true,
              },
            },
          },
        });

        if (order && orderMovedToProcessing) {
          const attributedPurchases = order.orderItems.flatMap((item) => {
            const value = item.recommendationContext;
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
              return [];
            }
            const context = value as Record<string, unknown>;
            if (
              typeof context.requestId !== 'string' ||
              typeof context.surface !== 'string' ||
              typeof context.rankerVersion !== 'string' ||
              typeof context.position !== 'number' ||
              typeof context.sessionId !== 'string'
            ) {
              return [];
            }
            return [
              {
                eventType: 'PURCHASE',
                surface: context.surface,
                requestId: context.requestId,
                rankerVersion: context.rankerVersion,
                position: context.position,
                productId: item.productId,
                vendorId: item.vendorId,
                userId: payment.userId,
                sessionId: context.sessionId,
              },
            ];
          });
          if (attributedPurchases.length > 0) {
            await tx.recommendationEvent.createMany({
              data: attributedPurchases,
            });
          }

          const earnings = this.calculateVendorEarnings(
            order.orderItems,
            await loadVendorFundedDiscounts(tx, payment.orderId),
          );

          for (const [vendorId, earning] of earnings) {
            // A vendor-funded discount can reduce earnings to zero.
            if (earning.lessThanOrEqualTo(0)) continue;
            await this.walletService.creditVendorPending(
              vendorId,
              earning,
              payment.orderId,
              tx,
            );
          }
        }

        if (orderMovedToProcessing) {
          // Facts for the notification and email consumers, committed or rolled back with this change.
          await this.publishOrderProcessingEvent(ctx, payment.orderId);
          await this.publishPaymentConfirmedEvent(ctx, payment.id);

          await this.queueNotifications(ctx, payment, order);
          ctx.afterCommit(() => this.invalidateCartCache(payment.userId));
        }

        await ctx.audit({
          action: orderMovedToProcessing
            ? 'PAYMENT_CONFIRMED'
            : 'PAYMENT_CAPTURED_ORDER_NOT_PENDING',
          entity: 'PAYMENT',
          entityId: payment.id,
          userId: payment.userId,
          payload: {
            orderId: payment.orderId,
            orderStatus: order?.status ?? null,
            settlementRequiresReview: !orderMovedToProcessing,
            amount: Number(payment.amount),
            currency: payment.currency,
            reference,
          },
        });
        return {
          updated: await tx.payment.findUniqueOrThrow({
            where: { id: payment.id },
          }),
          orderMovedToProcessing,
        };
      },
      { name: 'payment.confirm' },
    );
    return { updated, orderMovedToProcessing };
  }

  /** The customer's, the vendors' and the admins' "payment received / new order" notices. */
  private async queueNotifications(
    ctx: TransactionContext,
    payment: Prisma.PaymentGetPayload<object>,
    order: {
      orderNumber: string;
      orderItems: Array<{ vendorId: string }>;
    } | null,
  ): Promise<void> {
    const amount = Number(payment.amount);
    const orderNumber = order?.orderNumber ?? payment.orderId;
    const customerNotification = {
      userId: payment.userId,
      role: ROLE.USER,
      type: NotificationType.PAYMENT_RECEIVED,
      title: 'Payment Successful',
      message: `Payment of ${payment.currency.toUpperCase()} ${amount} confirmed for order #${orderNumber}.`,
      priority: NotificationPriority.HIGH,
      link: `/order/${payment.orderId}`,
      metadata: { paymentId: payment.id, orderId: payment.orderId },
      dedupeKey: `PAYMENT_RECEIVED:${payment.id}:USER:${payment.userId}`,
    };
    await ctx.emit(
      'payment',
      payment.id,
      RABBITMQ_ROUTING_KEYS.NOTIFICATION_DISPATCH,
      customerNotification,
    );
    await ctx.emit(
      'order',
      payment.orderId,
      RABBITMQ_ROUTING_KEYS.NOTIFICATION_DISPATCH,
      {
        userId: payment.userId,
        role: ROLE.USER,
        type: NotificationType.ORDER_CONFIRMED,
        title: 'Order Confirmed',
        message: `Your order #${orderNumber} is now processing.`,
        priority: NotificationPriority.HIGH,
        link: `/order/${payment.orderId}`,
        metadata: { orderId: payment.orderId },
        dedupeKey: `ORDER_CONFIRMED:${payment.orderId}:USER:${payment.userId}`,
      },
    );

    for (const vendorId of new Set(
      order?.orderItems.map((item) => item.vendorId) ?? [],
    )) {
      await ctx.emit(
        'order',
        payment.orderId,
        RABBITMQ_ROUTING_KEYS.NOTIFICATION_DISPATCH,
        {
          userId: vendorId,
          role: ROLE.VENDOR,
          type: NotificationType.ORDER_CONFIRMED,
          title: 'New Order Received',
          message: `You have received a new sale for order #${orderNumber}.`,
          priority: NotificationPriority.HIGH,
          link: `/vendor/order/${payment.orderId}`,
          metadata: { orderId: payment.orderId, orderNumber },
          dedupeKey: `ORDER_CONFIRMED:${payment.orderId}:VENDOR:${vendorId}`,
        },
      );
    }

    const admins = await ctx.tx.admin.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const admin of admins) {
      await ctx.emit(
        'payment',
        payment.id,
        RABBITMQ_ROUTING_KEYS.NOTIFICATION_DISPATCH,
        {
          userId: admin.id,
          role: ROLE.ADMIN,
          type: NotificationType.PAYMENT_RECEIVED,
          title: 'Payment Confirmed',
          message: `Payment of ${payment.currency.toUpperCase()} ${amount} confirmed for order #${orderNumber}.`,
          priority: NotificationPriority.MEDIUM,
          link: `/admin/order/${payment.orderId}`,
          metadata: {
            paymentId: payment.id,
            orderId: payment.orderId,
            orderNumber,
          },
          dedupeKey: `PAYMENT_RECEIVED:${payment.id}:ADMIN:${admin.id}`,
        },
      );
    }
  }

  async markFailed(reference: string, reason?: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: {
        transactionReference: reference,
        status: PaymentStatus.PENDING,
      },
      include: {
        user: { select: { email: true, firstName: true } },
        order: { select: { orderNumber: true } },
      },
    });

    if (!payment) return;

    // The status change and the payment.failed event commit together: only the delivery that
    // actually moved the payment from PENDING to FAILED publishes the event.
    await this.transactions.run(
      async (ctx) => {
        const tx = ctx.tx;
        const moved = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PENDING,
          },
          data: {
            status: PaymentStatus.FAILED,
          },
        });
        if (moved.count !== 1 || !payment.user || !payment.order) return;

        const payload: PaymentFailedPayload = {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.order.orderNumber,
          userId: payment.userId,
          userEmail: payment.user.email,
          userFirstName: payment.user.firstName,
          reason,
        };
        await ctx.publish({
          type: DomainEvents.PAYMENT_FAILED,
          aggregate: { type: 'payment', id: payment.id },
          payload,
        });
      },
      { name: 'payment.mark-failed' },
    );
  }

  private async invalidateCartCache(userId: string): Promise<void> {
    if (this.cacheService) {
      try {
        await this.cacheService.del(`${CART_CACHE_PREFIX}${userId}`);
      } catch (error) {
        this.logger.warn(
          `Failed to invalidate cart cache for user ${userId}: ${(error as Error).message}`,
        );
      }
    }
  }

  private calculateVendorEarnings(
    items: Array<{
      vendorId: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
    }>,
    vendorFundedDiscounts: Map<string, Prisma.Decimal> = new Map(),
  ): Map<string, Prisma.Decimal> {
    return computeVendorEarnings(
      items,
      VENDOR_COMMISSION_RATE,
      vendorFundedDiscounts,
    );
  }

  private async publishOrderProcessingEvent(
    ctx: TransactionContext,
    orderId: string,
  ): Promise<void> {
    const order = await ctx.tx.order.findUnique({
      where: {
        id: orderId,
      },

      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
          },
        },

        payment: {
          select: {
            currency: true,
          },
        },

        orderItems: {
          include: {
            product: {
              select: {
                name: true,
              },
            },

            variant: {
              select: {
                options: true,
              },
            },
          },
        },
      },
    });

    if (!order || !order.user || !order.payment) {
      return;
    }

    const payload: OrderProcessingPayload = {
      orderId: order.id,

      orderNumber: order.orderNumber,

      userId: order.userId,

      userEmail: order.user.email,

      userFirstName: order.user.firstName,

      totalAmount: Number(order.totalAmount),

      finalAmount: Number(order.finalAmount),

      currency: order.payment.currency,

      vendorIds: [...new Set(order.orderItems.map((item) => item.vendorId))],

      items: order.orderItems.map((item) => ({
        productName: item.product.name,

        quantity: item.quantity,

        unitPrice: Number(item.unitPrice),

        totalPrice: Number(item.totalPrice),

        variantOptions: item.variant
          ? (item.variant.options as {
              name: string;
              value: string;
            }[])
          : undefined,
      })),

      shippingAddress: order.shippingAddress ?? '',
    };

    await ctx.publish({
      type: DomainEvents.ORDER_PROCESSING,
      aggregate: { type: 'order', id: orderId },
      payload,
    });
  }

  private async publishPaymentConfirmedEvent(
    ctx: TransactionContext,
    paymentId: string,
  ): Promise<void> {
    const payment = await ctx.tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        user: {
          select: {
            email: true,
            firstName: true,
          },
        },
        order: {
          select: {
            orderNumber: true,
          },
        },
      },
    });

    if (!payment || !payment.user || !payment.order) return;

    const payload: PaymentConfirmedPayload = {
      paymentId: payment.id,
      orderId: payment.orderId,
      orderNumber: payment.order.orderNumber,
      userId: payment.userId,
      userEmail: payment.user.email,
      userFirstName: payment.user.firstName,
      amount: Number(payment.amount),
      currency: payment.currency,
      paymentReference: payment.transactionReference ?? '',
    };

    await ctx.publish({
      type: DomainEvents.PAYMENT_CONFIRMED,
      aggregate: { type: 'payment', id: paymentId },
      payload,
    });
  }
}
