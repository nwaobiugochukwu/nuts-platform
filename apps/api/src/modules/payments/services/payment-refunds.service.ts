import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  NotificationPriority,
  NotificationType,
  OrderStatus,
  PaymentRefundStatus,
  PaymentStatus,
  Prisma,
  ROLE,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { runWithCronLock } from '@api/infrastructure/cache/cron-lock.util';
import { REDIS_CLIENT } from '@api/infrastructure/cache/redis.constants';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';
import { RABBITMQ_ROUTING_KEYS } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { generateStatusNote } from '@api/modules/orders/constants/order-status.constants';
import {
  loadCreditedVendorEarnings,
  releaseDiscountUsage,
} from '@api/modules/discounts/utils/discount-funding.util';
import { WalletService } from '@api/modules/wallets/services/wallet.service';
import { PaymentResponseDto } from '../dto/payment-response.dto';
import type { PaystackWebhookEvent } from '../types/paystack.types';
import { toPaystackAmount, moneyEquals } from '../utils/payment-money.util';
import { toPaymentResponse } from '../utils/payment-response.util';
import { restoreOrderStock } from '@api/common/utils/restore-order-stock.util';
import { PaystackClientService } from './paystack-client.service';

interface PaystackRefundRecord {
  id?: number;
  reference?: string;
  status?: string;
  amount?: number | string;
}

interface PaystackRefundListResponse {
  status: boolean;
  message: string;
  data: PaystackRefundRecord[];
}

interface PaystackRefundResponse {
  status: boolean;
  message: string;
  data: PaystackRefundRecord;
}

/**
 * Refunds: an admin asks for one, it is submitted to Paystack under a reference saved first (so a
 * timeout-safe retry reuses it), and a `refund.*` webhook or the reconcile job settles it. Settling
 * puts the order, the payment, the stock, the vendor wallet and the discount usage back in one
 * transaction, with the audit entry and the customer's notice written in it.
 */
@Injectable()
export class PaymentRefundsService {
  private readonly logger = new Logger(PaymentRefundsService.name);
  private isReconcilingRefunds = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRunnerService,
    private readonly walletService: WalletService,
    private readonly paystack: PaystackClientService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  /** Applies a `refund.*` webhook from Paystack to the local refund attempt it is about. */
  async handleWebhook(event: PaystackWebhookEvent): Promise<void> {
    const data = event.data;
    if (!data) return;

    const providerReference =
      data.refund_reference?.trim() || data.reference?.trim();
    let refund = providerReference
      ? await this.prisma.paymentRefund.findUnique({
          where: { providerReference },
          include: {
            payment: {
              select: {
                amount: true,
                currency: true,
                transactionReference: true,
              },
            },
          },
        })
      : null;

    const transactionReference =
      data.transaction_reference?.trim() || data.reference?.trim();
    if (!refund && transactionReference) {
      refund = await this.prisma.paymentRefund.findFirst({
        where: {
          payment: {
            OR: [
              { transactionReference },
              { transactionId: transactionReference },
            ],
          },
          status: { in: this.activeRefundStatuses() },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          payment: {
            select: {
              amount: true,
              currency: true,
              transactionReference: true,
            },
          },
        },
      });
    }

    if (!refund) {
      this.logger.warn(
        `Acknowledging Paystack ${event.event} event without a matching local refund attempt.`,
      );
      return;
    }

    if (data.amount !== undefined) {
      const providerAmount = Number(data.amount);
      if (
        !Number.isFinite(providerAmount) ||
        providerAmount !== toPaystackAmount(refund.amount)
      ) {
        throw new BadRequestException(
          `Paystack refund amount does not match local attempt ${refund.providerReference}.`,
        );
      }
    }
    if (
      data.currency &&
      data.currency.toUpperCase() !== refund.payment.currency.toUpperCase()
    ) {
      throw new BadRequestException(
        `Paystack refund currency does not match local attempt ${refund.providerReference}.`,
      );
    }

    const providerStatus = data.status || event.event.slice('refund.'.length);
    await this.applyProviderRefundStatus(
      refund.id,
      providerStatus,
      typeof data.id === 'number' ? data.id : undefined,
    );
  }

  /** An admin asks for a full refund of a payment; the provider call is retried until it settles. */
  async refund(
    paymentId: string,
    adminId: string,
    amount?: number,
  ): Promise<PaymentResponseDto> {
    this.paystack.assertConfigured();

    const claim = await this.transactions.run(
      async (ctx) => {
        const tx = ctx.tx;
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: {
            order: {
              include: {
                orderItems: {
                  select: {
                    productId: true,
                    variantId: true,
                    quantity: true,
                    vendorId: true,
                    unitPrice: true,
                  },
                },
              },
            },
          },
        });

        if (!payment) throw new NotFoundException('Payment not found.');
        if (amount !== undefined && !moneyEquals(amount, payment.amount)) {
          throw new BadRequestException('Partial refunds are not supported.');
        }

        const latestRefund = await tx.paymentRefund.findFirst({
          where: { paymentId },
          orderBy: { createdAt: 'desc' },
        });
        const activeRefund =
          latestRefund && this.isRefundActive(latestRefund.status)
            ? latestRefund
            : null;

        if (activeRefund) return { refund: activeRefund, shouldSubmit: true };
        if (payment.status === PaymentStatus.REFUNDED && latestRefund) {
          return { refund: latestRefund, shouldSubmit: false };
        }
        if (payment.status !== PaymentStatus.SUCCESS) {
          throw new BadRequestException(
            'Only successful payments can be refunded.',
          );
        }
        if (
          payment.order.status === OrderStatus.SHIPPED ||
          payment.order.status === OrderStatus.DELIVERED ||
          payment.order.status === OrderStatus.REFUND_PENDING ||
          payment.order.status === OrderStatus.REFUNDED
        ) {
          throw new BadRequestException(
            'Refunds can only be requested before an order ships. Contact support for a return after shipment.',
          );
        }

        const transactionReference =
          payment.transactionId || payment.transactionReference;
        if (!transactionReference) {
          throw new BadRequestException(
            'Paystack transaction reference is missing.',
          );
        }

        const paymentClaim = await tx.payment.updateMany({
          where: { id: paymentId, status: PaymentStatus.SUCCESS },
          data: { status: PaymentStatus.REFUND_PENDING },
        });
        if (paymentClaim.count !== 1) {
          throw new ConflictException(
            'The payment changed while the refund was being requested. Refresh and retry.',
          );
        }

        const orderClaim = await tx.order.updateMany({
          where: { id: payment.orderId, status: payment.order.status },
          data: { status: OrderStatus.REFUND_PENDING },
        });
        if (orderClaim.count !== 1) {
          throw new ConflictException(
            'The order changed while the refund was being requested. Refresh and retry.',
          );
        }

        const refund = await tx.paymentRefund.create({
          data: {
            paymentId,
            amount: payment.amount,
            status: PaymentRefundStatus.REQUESTED,
            providerReference: `nuts_refund_${randomUUID().replace(/-/g, '')}`,
            requestedByAdminId: adminId,
            previousOrderStatus: payment.order.status,
          },
        });

        await tx.orderStatusHistory.create({
          data: {
            orderId: payment.orderId,
            fromStatus: payment.order.status,
            toStatus: OrderStatus.REFUND_PENDING,
            changedByAdminId: adminId,
            note: generateStatusNote({
              fromStatus: payment.order.status,
              toStatus: OrderStatus.REFUND_PENDING,
              changedByAdminId: adminId,
              manualNote: `Paystack refund ${refund.providerReference} requested.`,
            }),
          },
        });

        await ctx.audit({
          action: 'PAYMENT_REFUND_REQUESTED',
          entity: 'PAYMENT',
          entityId: paymentId,
          adminId,
          payload: {
            orderId: payment.orderId,
            refundId: refund.id,
            providerReference: refund.providerReference,
            amount: Number(payment.amount),
          },
        });

        return { refund, shouldSubmit: true };
      },
      { name: 'payment.refund.request' },
    );

    if (claim.shouldSubmit) await this.reconcileRefundAttempt(claim.refund.id);

    const [updated, latestRefund] = await Promise.all([
      this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
      this.prisma.paymentRefund.findUniqueOrThrow({
        where: { id: claim.refund.id },
      }),
    ]);
    return { ...toPaymentResponse(updated), refundStatus: latestRefund.status };
  }

  private isRefundActive(status: PaymentRefundStatus): boolean {
    return this.activeRefundStatuses().includes(status);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePendingRefunds(): Promise<void> {
    // The per-refund claim below is not exclusive, so two instances would both ask Paystack
    // about the same refund. The lock keeps it to one.
    if (!this.redis) return this.reconcilePendingRefundsOnce();
    await runWithCronLock(
      this.redis,
      'cron:lock:refund-reconcile',
      4 * 60_000,
      () => this.reconcilePendingRefundsOnce(),
    );
  }

  private async reconcilePendingRefundsOnce(): Promise<void> {
    if (this.isReconcilingRefunds) return;
    this.isReconcilingRefunds = true;
    try {
      const attempts = await this.prisma.paymentRefund.findMany({
        where: {
          status: {
            in: [
              PaymentRefundStatus.REQUESTED,
              PaymentRefundStatus.PENDING,
              PaymentRefundStatus.PROCESSING,
              PaymentRefundStatus.NEEDS_ATTENTION,
            ],
          },
          attempts: { lt: 25 },
        },
        orderBy: { updatedAt: 'asc' },
        take: 20,
        select: { id: true },
      });
      await Promise.allSettled(
        attempts.map(({ id }) => this.reconcileRefundAttempt(id)),
      );

      const stalled = await this.prisma.paymentRefund.count({
        where: {
          status: {
            in: [
              PaymentRefundStatus.REQUESTED,
              PaymentRefundStatus.PENDING,
              PaymentRefundStatus.PROCESSING,
              PaymentRefundStatus.NEEDS_ATTENTION,
            ],
          },
          attempts: { gte: 25 },
        },
      });
      if (stalled > 0) {
        this.logger.error(
          `${stalled} refund attempt(s) reached the automatic reconciliation limit and need operator review.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Refund reconciliation job failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isReconcilingRefunds = false;
    }
  }

  /**
   * Paystack references are persisted before this method is called. Looking up
   * first and reusing the same reference makes a timeout-safe retry idempotent.
   */
  private async reconcileRefundAttempt(refundId: string): Promise<void> {
    const refund = await this.prisma.paymentRefund.findUnique({
      where: { id: refundId },
      include: {
        payment: {
          select: {
            transactionId: true,
            transactionReference: true,
            amount: true,
          },
        },
      },
    });
    if (!refund || !this.isRefundActive(refund.status)) return;

    const attemptClaimed = await this.prisma.paymentRefund.updateMany({
      where: { id: refund.id, status: { in: this.activeRefundStatuses() } },
      data: { attempts: { increment: 1 }, lastCheckedAt: new Date() },
    });
    if (attemptClaimed.count !== 1) return;
    const attempt = await this.prisma.paymentRefund.findUniqueOrThrow({
      where: { id: refund.id },
      select: { attempts: true },
    });

    try {
      const lookup = await this.paystack.get<PaystackRefundListResponse>(
        `https://api.paystack.co/refund?reference=${encodeURIComponent(refund.providerReference)}`,
      );
      if (!lookup.status || !Array.isArray(lookup.data)) {
        throw new ServiceUnavailableException(
          lookup.message ||
            'Paystack refund lookup returned an invalid response.',
        );
      }

      const existing = lookup.data.find(
        (record) =>
          record.reference?.toLowerCase() ===
          refund.providerReference.toLowerCase(),
      );
      if (existing?.status) {
        this.assertProviderRefundAmount(
          existing,
          refund.amount,
          refund.providerReference,
        );
        await this.applyProviderRefundStatus(
          refund.id,
          existing.status,
          existing.id,
        );
        return;
      }

      const transaction =
        refund.payment.transactionId || refund.payment.transactionReference;
      if (!transaction) {
        throw new BadRequestException(
          'Paystack transaction reference is missing.',
        );
      }
      const created = await this.paystack.post<PaystackRefundResponse>(
        'https://api.paystack.co/refund',
        {
          transaction,
          amount: toPaystackAmount(refund.amount),
          reference: refund.providerReference,
        },
      );
      if (!created.status || !created.data?.status) {
        throw new ServiceUnavailableException(
          created.message || 'Paystack did not accept the refund request.',
        );
      }
      this.assertProviderRefundAmount(
        created.data,
        refund.amount,
        refund.providerReference,
      );
      if (
        !created.data.reference ||
        created.data.reference.toLowerCase() !==
          refund.providerReference.toLowerCase()
      ) {
        throw new ServiceUnavailableException(
          `Paystack returned a different reference for refund ${refund.providerReference}.`,
        );
      }
      await this.applyProviderRefundStatus(
        refund.id,
        created.data.status,
        created.data.id,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.paymentRefund.updateMany({
        where: {
          id: refund.id,
          status: {
            in: [
              PaymentRefundStatus.REQUESTED,
              PaymentRefundStatus.PENDING,
              PaymentRefundStatus.PROCESSING,
              PaymentRefundStatus.NEEDS_ATTENTION,
            ],
          },
        },
        data: { lastError: message.slice(0, 1000) },
      });
      this.logger.warn(
        `Paystack refund ${refund.providerReference} reconciliation attempt ${attempt.attempts} did not complete: ${message}`,
      );
    }
  }

  private async applyProviderRefundStatus(
    refundId: string,
    providerStatus: string,
    providerRefundId?: number,
  ): Promise<void> {
    const status = this.toRefundStatus(providerStatus);
    if (!status) {
      this.logger.warn(
        `Ignoring unknown Paystack refund status '${providerStatus}' for attempt ${refundId}.`,
      );
      return;
    }

    await this.transactions.run(
      async (ctx) => {
        const tx = ctx.tx;
        const refund = await tx.paymentRefund.findUnique({
          where: { id: refundId },
          include: {
            payment: {
              include: {
                order: {
                  include: {
                    orderItems: {
                      select: {
                        productId: true,
                        variantId: true,
                        quantity: true,
                        vendorId: true,
                        unitPrice: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });
        if (!refund || !this.isRefundActive(refund.status)) return;

        if (
          status === PaymentRefundStatus.PENDING &&
          refund.status !== PaymentRefundStatus.REQUESTED
        )
          return;
        if (
          status === PaymentRefundStatus.PROCESSING &&
          refund.status === PaymentRefundStatus.NEEDS_ATTENTION
        ) {
          // A manual provider retry may return a refund to processing.
        } else if (
          status === PaymentRefundStatus.PROCESSING &&
          refund.status === PaymentRefundStatus.PROCESSING
        ) {
          return;
        }

        if (status === PaymentRefundStatus.FAILED) {
          const claimed = await tx.paymentRefund.updateMany({
            where: {
              id: refund.id,
              status: { in: this.activeRefundStatuses() },
            },
            data: {
              status,
              providerStatus,
              providerRefundId: providerRefundId
                ? String(providerRefundId)
                : undefined,
              failedAt: new Date(),
              lastError: null,
            },
          });
          if (claimed.count !== 1) return;

          const paymentRestored = await tx.payment.updateMany({
            where: {
              id: refund.paymentId,
              status: PaymentStatus.REFUND_PENDING,
            },
            data: { status: PaymentStatus.SUCCESS },
          });
          const orderRestored = await tx.order.updateMany({
            where: {
              id: refund.payment.orderId,
              status: OrderStatus.REFUND_PENDING,
            },
            data: { status: refund.previousOrderStatus },
          });
          if (paymentRestored.count !== 1 || orderRestored.count !== 1) {
            throw new ConflictException(
              `Could not restore payment/order state after failed refund ${refund.providerReference}.`,
            );
          }
          await tx.orderStatusHistory.create({
            data: {
              orderId: refund.payment.orderId,
              fromStatus: OrderStatus.REFUND_PENDING,
              toStatus: refund.previousOrderStatus,
              changedByAdminId: refund.requestedByAdminId,
              note: `Paystack refund failed (${providerStatus}); previous order state restored.`,
            },
          });
          await ctx.audit({
            action: 'PAYMENT_REFUND_FAILED',
            entity: 'PAYMENT',
            entityId: refund.paymentId,
            adminId: refund.requestedByAdminId,
            payload: {
              refundId: refund.id,
              providerReference: refund.providerReference,
              providerStatus,
              amount: Number(refund.amount),
            },
          });
          return;
        }

        if (status === PaymentRefundStatus.PROCESSED) {
          const claimed = await tx.paymentRefund.updateMany({
            where: {
              id: refund.id,
              status: { in: this.activeRefundStatuses() },
            },
            data: {
              status,
              providerStatus,
              providerRefundId: providerRefundId
                ? String(providerRefundId)
                : undefined,
              processedAt: new Date(),
              lastError: null,
            },
          });
          if (claimed.count !== 1) return;

          const paymentUpdated = await tx.payment.updateMany({
            where: {
              id: refund.paymentId,
              status: PaymentStatus.REFUND_PENDING,
            },
            data: { status: PaymentStatus.REFUNDED },
          });
          const orderUpdated = await tx.order.updateMany({
            where: {
              id: refund.payment.orderId,
              status: OrderStatus.REFUND_PENDING,
            },
            data: { status: OrderStatus.REFUNDED },
          });
          if (paymentUpdated.count !== 1 || orderUpdated.count !== 1) {
            throw new ConflictException(
              `Could not complete local state transition for processed refund ${refund.providerReference}.`,
            );
          }

          const currentOrder = refund.payment.order;
          if (!currentOrder.stockRestored) {
            await restoreOrderStock(
              tx,
              currentOrder.orderItems,
              'Stock restored after Paystack refund processed',
            );
            await tx.order.update({
              where: { id: currentOrder.id },
              data: { stockRestored: true },
            });
          }

          // Reverse exactly what was credited (ledger amounts), not a
          // recomputation, so the vendor wallet nets to zero on refund.
          const creditedEarnings = await loadCreditedVendorEarnings(
            tx,
            currentOrder.id,
          );
          for (const [vendorId, earning] of creditedEarnings) {
            if (earning.lessThanOrEqualTo(0)) continue;
            await this.walletService.debitVendorPending(
              vendorId,
              earning,
              currentOrder.id,
              tx,
            );
          }

          // The refunded order will not redeem its discount.
          await releaseDiscountUsage(tx, currentOrder.id);

          await tx.orderStatusHistory.create({
            data: {
              orderId: currentOrder.id,
              fromStatus: OrderStatus.REFUND_PENDING,
              toStatus: OrderStatus.REFUNDED,
              changedByAdminId: refund.requestedByAdminId,
              note: generateStatusNote({
                fromStatus: OrderStatus.REFUND_PENDING,
                toStatus: OrderStatus.REFUNDED,
                changedByAdminId: refund.requestedByAdminId,
                manualNote: `Paystack refund ${refund.providerReference} processed.`,
              }),
            },
          });
          await ctx.audit({
            action: 'PAYMENT_REFUNDED',
            entity: 'PAYMENT',
            entityId: refund.paymentId,
            adminId: refund.requestedByAdminId,
            payload: {
              refundId: refund.id,
              providerReference: refund.providerReference,
              providerRefundId: providerRefundId
                ? String(providerRefundId)
                : null,
              amount: Number(refund.amount),
            },
          });
          await ctx.emit(
            'payment_refund',
            refund.id,
            RABBITMQ_ROUTING_KEYS.NOTIFICATION_DISPATCH,
            {
              userId: refund.payment.userId,
              role: ROLE.USER,
              type: NotificationType.PAYMENT_REFUNDED,
              title: 'Refund processed',
              message: `Your refund of ${refund.payment.currency.toUpperCase()} ${Number(refund.amount).toFixed(2)} has been processed for order #${currentOrder.orderNumber}.`,
              priority: NotificationPriority.HIGH,
              link: `/order/${currentOrder.id}`,
              metadata: {
                orderId: currentOrder.id,
                refundId: refund.id,
                providerReference: refund.providerReference,
              },
              dedupeKey: `PAYMENT_REFUNDED:${refund.id}:USER:${refund.payment.userId}`,
            },
          );
          return;
        }

        await tx.paymentRefund.update({
          where: { id: refund.id },
          data: {
            status,
            providerStatus,
            providerRefundId: providerRefundId
              ? String(providerRefundId)
              : undefined,
            lastCheckedAt: new Date(),
            lastError: null,
          },
        });
        if (status !== refund.status) {
          await ctx.audit({
            action: 'PAYMENT_REFUND_STATUS_CHANGED',
            entity: 'PAYMENT_REFUND',
            entityId: refund.id,
            adminId: refund.requestedByAdminId,
            payload: {
              paymentId: refund.paymentId,
              providerReference: refund.providerReference,
              fromStatus: refund.status,
              toStatus: status,
              providerStatus,
            },
          });
        }
      },
      { name: 'payment.refund.apply-status' },
    );
  }

  private activeRefundStatuses(): PaymentRefundStatus[] {
    return [
      PaymentRefundStatus.REQUESTED,
      PaymentRefundStatus.PENDING,
      PaymentRefundStatus.PROCESSING,
      PaymentRefundStatus.NEEDS_ATTENTION,
    ];
  }

  private toRefundStatus(status: string): PaymentRefundStatus | null {
    switch (status.trim().toLowerCase()) {
      case 'pending':
        return PaymentRefundStatus.PENDING;
      case 'processing':
        return PaymentRefundStatus.PROCESSING;
      case 'needs-attention':
        return PaymentRefundStatus.NEEDS_ATTENTION;
      case 'failed':
        return PaymentRefundStatus.FAILED;
      case 'processed':
        return PaymentRefundStatus.PROCESSED;
      default:
        return null;
    }
  }

  private assertProviderRefundAmount(
    record: PaystackRefundRecord,
    expectedAmount: Prisma.Decimal,
    providerReference: string,
  ): void {
    if (record.amount === undefined) return;
    const amount = Number(record.amount);
    if (
      !Number.isFinite(amount) ||
      amount !== toPaystackAmount(expectedAmount)
    ) {
      throw new ServiceUnavailableException(
        `Paystack refund amount does not match local attempt ${providerReference}.`,
      );
    }
  }
}
