import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationPriority,
  NotificationType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ROLE,
} from '@prisma/client';
import { VENDOR_COMMISSION_RATE } from '@api/common/constants/commission.constants';
import { restoreOrderStock } from '@api/common/utils/restore-order-stock.util';
import {
  TransactionRunnerService,
  type TransactionContext,
} from '@api/infrastructure/database/transaction-runner.service';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import type {
  OrderCancelledPayload,
  OrderDeliveredPayload,
  OrderShippedPayload,
} from '@api/infrastructure/messaging/events/event-payloads.types';
import { RABBITMQ_ROUTING_KEYS } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import {
  computeVendorEarnings,
  loadCreditedVendorEarnings,
  loadVendorFundedDiscounts,
  releaseDiscountUsage,
} from '@api/modules/discounts/utils/discount-funding.util';
import { WalletService } from '@api/modules/wallets/services/wallet.service';
import {
  assertValidOrderTransition,
  generateStatusNote,
  shouldRestoreStock,
} from '../constants/order-status.constants';

/**
 * Order status changes. The one place that moves an order from one status to the next, so no
 * controller or other service ever updates `order.status` directly.
 */
@Injectable()
export class OrderStatusService {
  constructor(
    private readonly transactions: TransactionRunnerService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Moves an order to the next status in one transaction: the state machine, stock and discount
   * hand-back on cancellation, the customer's notice and the status event (both written in the
   * transaction), and settling vendor earnings on delivery.
   */
  async transition(params: {
    orderId: string;
    nextStatus: OrderStatus;
    changedByUserId?: string;
    changedByVendorId?: string;
    changedByAdminId?: string;
    note?: string;
  }): Promise<string> {
    const {
      orderId,
      nextStatus,
      changedByUserId,
      changedByVendorId,
      changedByAdminId,
      note,
    } = params;

    let originalStatus: OrderStatus | undefined;

    try {
      await this.transactions.run(
        async (ctx) => {
          const tx = ctx.tx;
          const current = await tx.order.findUnique({
            where: {
              id: orderId,
            },
            include: {
              orderItems: true,
              payment: true,
            },
          });

          if (!current) {
            throw new NotFoundException('Order not found');
          }

          originalStatus = current.status;

          if (originalStatus === nextStatus) {
            return;
          }

          /**
           * Keep the state machine in one central place.
           *
           * Never allow controllers to directly update order.status.
           */
          assertValidOrderTransition(originalStatus, nextStatus);

          /**
           * Never silently convert a successful Paystack payment into a
           * "refunded" payment just because somebody cancelled an order.
           */
          if (
            nextStatus === OrderStatus.CANCELLED &&
            current.payment?.status === PaymentStatus.SUCCESS
          ) {
            throw new BadRequestException(
              'A paid order must be refunded through the payment refund workflow.',
            );
          }

          /**
           * Conditional update makes the transition concurrency-safe.
           *
           * If another request changed the status after our read, count=0.
           */
          const updated = await tx.order.updateMany({
            where: {
              id: orderId,
              status: originalStatus,
            },
            data: {
              status: nextStatus,
            },
          });

          if (updated.count !== 1) {
            throw new ConflictException(
              'Order status was updated by another request. Refresh and retry.',
            );
          }

          const restoreStock =
            shouldRestoreStock(originalStatus, nextStatus) &&
            !current.stockRestored;

          if (restoreStock) {
            await restoreOrderStock(
              tx,
              current.orderItems,
              'Stock restored after order cancellation',
            );

            /**
             * This flag is the idempotency guard for stock restoration.
             */
            await tx.order.update({
              where: {
                id: orderId,
              },
              data: {
                stockRestored: true,
              },
            });
          }

          // A cancelled (necessarily unpaid) order will never redeem its
          // discount: hand the redemption back.
          if (nextStatus === OrderStatus.CANCELLED) {
            await releaseDiscountUsage(tx, orderId);
          }

          /**
           * Only transition an unpaid payment to FAILED when the order is
           * cancelled.
           *
           * SUCCESS is deliberately not changed here because a real payment
           * must be refunded through Paystack.
           */
          if (
            current.payment &&
            nextStatus === OrderStatus.CANCELLED &&
            current.payment.status === PaymentStatus.PENDING
          ) {
            await tx.payment.update({
              where: {
                id: current.payment.id,
              },
              data: {
                status: PaymentStatus.FAILED,
              },
            });
          }

          await tx.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: originalStatus,
              toStatus: nextStatus,
              changedByUserId,
              changedByVendorId,
              changedByAdminId,
              note: generateStatusNote({
                fromStatus: originalStatus,
                toStatus: nextStatus,
                changedByUserId,
                changedByVendorId,
                changedByAdminId,
                manualNote: note?.trim() || undefined,
              }),
            },
          });

          const orderNotification = this.orderStatusNotification(
            current.userId,
            current.id,
            current.orderNumber,
            nextStatus,
          );
          if (orderNotification) {
            await ctx.emit(
              'order',
              current.id,
              RABBITMQ_ROUTING_KEYS.NOTIFICATION_DISPATCH,
              orderNotification,
            );
          }

          // The fact the email and notification consumers react to, committed with the change.
          await this.publishStatusChangeEvent(
            ctx,
            current.id,
            nextStatus,
            current.userId,
          );

          /**
           * Vendor earnings are credited when payment succeeds.
           * They are therefore only settled after delivery.
           */
          if (nextStatus === OrderStatus.DELIVERED) {
            // Settle exactly what was credited at payment time; fall back to
            // the computed figure only for vendors with no ledger entry.
            const credited = await loadCreditedVendorEarnings(tx, orderId);
            const vendorEarnings = this.calculateVendorEarnings(
              current.orderItems,
              await loadVendorFundedDiscounts(tx, orderId),
            );
            for (const [vendorId, computed] of vendorEarnings) {
              const amount = credited.get(vendorId) ?? computed;
              if (amount.lessThanOrEqualTo(0)) continue;
              await this.walletService.settleVendorEarning(
                vendorId,
                amount,
                orderId,
                tx,
              );
            }
          }

          /**
           * If a paid order is cancelled, this path should normally not run
           * because paid orders must go through the refund workflow.
           *
           * For an unpaid order there are no vendor pending earnings, so
           * there is nothing to debit.
           */
        },
        { name: 'order.transition-status' },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('Invalid order transition:')
      ) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }

    // Referral rewards are not granted here: they are a consumer of the order.delivered event
    // written in the transaction above (ReferralRewardConsumer), so a crash cannot skip them.

    return orderId;
  }

  private orderStatusNotification(
    userId: string,
    orderId: string,
    orderNumber: string,
    status: OrderStatus,
  ):
    | {
        userId: string;
        role: ROLE;
        type: NotificationType;
        title: string;
        message: string;
        priority: NotificationPriority;
        link: string;
        metadata: { orderId: string };
        dedupeKey: string;
      }
    | undefined {
    const notifications: Partial<
      Record<
        OrderStatus,
        { type: NotificationType; title: string; message: string }
      >
    > = {
      [OrderStatus.SHIPPED]: {
        type: NotificationType.ORDER_SHIPPED,
        title: 'Order Shipped',
        message: `Your order #${orderNumber} has shipped.`,
      },
      [OrderStatus.DELIVERED]: {
        type: NotificationType.ORDER_DELIVERED,
        title: 'Order Delivered',
        message: `Your order #${orderNumber} has been delivered.`,
      },
      [OrderStatus.CANCELLED]: {
        type: NotificationType.ORDER_CANCELLED,
        title: 'Order Cancelled',
        message: `Your order #${orderNumber} has been cancelled.`,
      },
    };
    const notification = notifications[status];
    if (!notification) return undefined;
    return {
      userId,
      role: ROLE.USER,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      priority: NotificationPriority.HIGH,
      link: `/order/${orderId}`,
      metadata: { orderId },
      dedupeKey: `${notification.type}:${orderId}:USER:${userId}`,
    };
  }

  private calculateVendorEarnings(
    items: Array<{
      vendorId: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
    }>,
    vendorFundedDiscounts: Map<string, Prisma.Decimal> = new Map(),
  ): Map<string, Prisma.Decimal> {
    // Decimal-only arithmetic; vendor-funded discounts reduce the vendor's
    // gross sales before commission (platform-funded ones do not).
    return computeVendorEarnings(
      items,
      VENDOR_COMMISSION_RATE,
      vendorFundedDiscounts,
    );
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private async publishStatusChangeEvent(
    ctx: TransactionContext,
    orderId: string,
    nextStatus: OrderStatus,
    orderUserId: string | undefined,
  ): Promise<void> {
    if (!orderUserId) {
      return;
    }

    {
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

              vendor: {
                select: {
                  id: true,
                  email: true,
                  storeName: true,
                },
              },
            },
          },
        },
      });

      if (!order?.user) {
        return;
      }

      const items = order.orderItems.map((item) => ({
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
      }));

      switch (nextStatus) {
        case OrderStatus.SHIPPED: {
          const payload: OrderShippedPayload = {
            orderId: order.id,
            orderNumber: order.orderNumber,
            userId: order.userId,
            userEmail: order.user.email,
            userFirstName: order.user.firstName,

            vendorEmails: order.orderItems.map((item) => ({
              vendorId: item.vendor.id,
              email: item.vendor.email,
              storeName: item.vendor.storeName,
            })),

            trackingNumber: undefined,

            items,
          };

          await ctx.publish({
            type: DomainEvents.ORDER_SHIPPED,
            aggregate: { type: 'order', id: order.id },
            payload,
          });

          break;
        }

        case OrderStatus.DELIVERED: {
          const payload: OrderDeliveredPayload = {
            orderId: order.id,
            orderNumber: order.orderNumber,
            userId: order.userId,
            userEmail: order.user.email,
            userFirstName: order.user.firstName,
            items,
          };

          await ctx.publish({
            type: DomainEvents.ORDER_DELIVERED,
            aggregate: { type: 'order', id: order.id },
            payload,
          });

          break;
        }

        case OrderStatus.CANCELLED: {
          const payload: OrderCancelledPayload = {
            orderId: order.id,
            orderNumber: order.orderNumber,
            userId: order.userId,
            userEmail: order.user.email,
            userFirstName: order.user.firstName,

            reason: undefined,

            refundProcessed: false,

            items,
          };

          await ctx.publish({
            type: DomainEvents.ORDER_CANCELLED,
            aggregate: { type: 'order', id: order.id },
            payload,
          });

          break;
        }
      }
    }
  }
}
