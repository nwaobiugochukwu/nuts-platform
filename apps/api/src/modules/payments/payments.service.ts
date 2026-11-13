import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  NotificationPriority,
  NotificationType,
  OrderStatus,
  PaymentRefundStatus,
  PaymentStatus,
  Prisma,
  ROLE,
  WalletTransactionReason,
  WalletTransactionType,
} from '@prisma/client';

import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

import { CART_CACHE_PREFIX } from '@api/modules/cart/cart.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { OutboxService } from '@api/infrastructure/outbox/outbox.service';
import { CircuitBreakerService } from '@api/infrastructure/resiliency/circuit-breaker.service';
import { UsersService } from '@api/modules/users/users.service';
import { WalletService } from '@api/modules/wallet/wallet.service';
import { RABBITMQ_ROUTING_KEYS } from '@api/infrastructure/rabbitmq/rabbitmq.constants';

import { generateStatusNote } from '@api/modules/orders/constants/order-status.constants';

import { DomainEvents } from '@api/common/events/domain-events';

import type {
  OrderProcessingPayload,
  PaymentConfirmedPayload,
  PaymentFailedPayload,
} from '@api/common/events/event-payloads';

import { VENDOR_COMMISSION_RATE } from '@api/common/constants/commission.constants';

import {
  PAYSTACK_SUCCESS_STATUS,
  PAYSTACK_TRANSACTION_INI_URL,
  PAYSTACK_TRANSACTION_VERIFY_BASE_URL,
  PAYSTACK_WEBHOOK_CRYPTO_ALGO,
} from '@api/common/constants/payment.constants';

import {
  InitializePaymentResponseDto,
  PaymentResponseDto,
} from './dto/payment-response.dto';

import type {
  PaystackApiResponse,
  PaystackInitializeData,
  PaystackInitializePayload,
  PaystackVerifyData,
  PaystackWebhookEvent,
} from './types/paystack.types';

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

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private isReconcilingRefunds = false;

  /**
   * External API timeout.
   *
   * Without an explicit timeout, an unavailable Paystack connection can
   * leave an HTTP request hanging for an unnecessarily long period.
   */
  private readonly paystackTimeoutMs = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly walletService: WalletService,
    private readonly eventEmitter: EventEmitter2,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly outbox: OutboxService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

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

  // ---------------------------------------------------------------------------
  // INITIALIZE PAYMENT
  // ---------------------------------------------------------------------------

  async initializeForOrder(
    userId: string,
    orderId: string,
  ): Promise<InitializePaymentResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    this.assertPaystackConfigured();

    /**
     * orderId is unique in Payment, therefore findUnique is preferable to
     * findFirst.
     */
    const payment = await this.prisma.payment.findUnique({
      where: {
        orderId,
      },
      select: {
        id: true,
        amount: true,
        status: true,
        currency: true,
        transactionReference: true,
        paymentLink: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            userId: true,
            status: true,
          },
        },
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    if (!payment || payment.order.userId !== userId) {
      throw new NotFoundException('Payment not found for this order');
    }

    if (payment.order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay for a cancelled order.');
    }

    if (payment.order.status === OrderStatus.REFUNDED) {
      throw new BadRequestException('This order has been refunded.');
    }

    if (
      payment.order.status === OrderStatus.REFUND_PENDING ||
      payment.status === PaymentStatus.REFUND_PENDING
    ) {
      throw new BadRequestException(
        'A refund is already being processed for this order.',
      );
    }

    if (payment.status === PaymentStatus.SUCCESS) {
      throw new BadRequestException('Order is already paid.');
    }

    if (payment.status === PaymentStatus.REFUNDED) {
      throw new BadRequestException('This payment has already been refunded.');
    }

    /**
     * If Paystack initialization already succeeded, simply return the stored
     * authorization URL.
     *
     * This makes initialization idempotent for normal retries.
     */
    if (payment.paymentLink && payment.transactionReference) {
      return {
        authorizationUrl: payment.paymentLink,

        reference: payment.transactionReference,

        paymentId: payment.id,
      };
    }

    /**
     * Claim a reference atomically.
     *
     * This prevents two simultaneous initialize requests from generating
     * different Paystack references for the same payment.
     */
    let reference = payment.transactionReference;

    if (!reference) {
      const generated = this.generateReference();

      const claimed = await this.prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.PENDING,
          transactionReference: null,
        },
        data: {
          transactionReference: generated,
          paymentMethod: 'paystack',
        },
      });

      if (claimed.count === 1) {
        reference = generated;
      } else {
        /**
         * Another request won the race.
         * Read its reference instead of creating another one.
         */
        const latest = await this.prisma.payment.findUnique({
          where: {
            id: payment.id,
          },
          select: {
            transactionReference: true,
            paymentLink: true,
          },
        });

        if (latest?.paymentLink && latest.transactionReference) {
          return {
            authorizationUrl: latest.paymentLink,

            reference: latest.transactionReference,

            paymentId: payment.id,
          };
        }

        reference = latest?.transactionReference ?? generated;
      }
    }

    const amountKobo = this.toPaystackAmount(payment.amount);

    const payload: PaystackInitializePayload = {
      email: payment.user.email,

      amount: amountKobo,

      currency: payment.currency.toUpperCase(),

      reference,

      metadata: {
        order_id: orderId,

        order_number: payment.order.orderNumber,

        user_id: userId,

        custom_fields: [
          {
            display_name: 'Order',

            variable_name: 'order_number',

            value: payment.order.orderNumber,
          },
        ],
      },
    };

    const configuredCallback = this.config
      .get<string>('PAYSTACK_CALLBACK_URL')
      ?.trim();
    const storefrontOrigin = this.config
      .get<string>('ALLOWED_ORIGINS')
      ?.split(',')[0]
      ?.trim();
    const fallbackCallback = storefrontOrigin
      ? `${storefrontOrigin.replace(/\/+$/, '')}/order-success`
      : undefined;

    const callbackUrl = configuredCallback || fallbackCallback;

    if (callbackUrl) {
      payload.callback_url = callbackUrl;
    }

    const result = await this.paystackPost<
      PaystackApiResponse<PaystackInitializeData>
    >(PAYSTACK_TRANSACTION_INI_URL, payload);

    if (!result.status || !result.data?.authorization_url) {
      throw new ServiceUnavailableException(
        result.message || 'Paystack initialization failed.',
      );
    }

    /**
     * Only update the row we claimed.
     *
     * This protects the payment from an old concurrent request overwriting
     * the reference/link produced by another request.
     */
    await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.PENDING,
        transactionReference: reference,
      },
      data: {
        transactionReference: result.data.reference,

        paymentLink: result.data.authorization_url,

        paymentMethod: 'paystack',
      },
    });

    return {
      authorizationUrl: result.data.authorization_url,

      accessCode: result.data.access_code,

      reference: result.data.reference,

      paymentId: payment.id,
    };
  }

  // ---------------------------------------------------------------------------
  // CALLBACK / VERIFICATION
  // ---------------------------------------------------------------------------

  async verifyByReference(reference: string): Promise<PaymentResponseDto> {
    this.assertPaystackConfigured();

    const normalized = reference.trim();

    if (!normalized) {
      throw new BadRequestException('Payment reference is required.');
    }

    const payment = await this.confirmPayment(normalized);

    if (!payment) {
      throw new NotFoundException('Payment not found or verification failed.');
    }

    return payment;
  }

  // ---------------------------------------------------------------------------
  // PAYSTACK WEBHOOK
  // ---------------------------------------------------------------------------

  async handleWebhook(
    rawBody: string,
    signature: string | undefined,
  ): Promise<void> {
    this.assertPaystackConfigured();

    if (!signature || !this.isValidWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid Paystack webhook signature.');
    }

    let event: PaystackWebhookEvent;

    try {
      event = JSON.parse(rawBody) as PaystackWebhookEvent;
    } catch {
      throw new BadRequestException('Invalid webhook payload.');
    }
    if (!event || typeof event.event !== 'string') {
      throw new BadRequestException('Webhook event type is required.');
    }

    if (event.event.startsWith('refund.')) {
      await this.handleRefundWebhook(event);
      return;
    }

    const reference = event.data?.reference?.trim();

    if (!reference) {
      /**
       * Paystack can send events that don't map to one of our payment rows.
       * They should be acknowledged rather than retried forever.
       */
      return;
    }

    const orderIdFromMetadata =
      (typeof event.data?.metadata?.order_id === 'string'
        ? event.data.metadata.order_id.trim()
        : undefined) ||
      (typeof event.data?.metadata?.orderId === 'string'
        ? event.data.metadata.orderId.trim()
        : undefined);

    if (
      event.event === 'charge.success' ||
      event.data?.status === PAYSTACK_SUCCESS_STATUS
    ) {
      await this.confirmPayment(reference, event.data, orderIdFromMetadata);

      return;
    }

    if (event.event === 'charge.failed') {
      await this.markPaymentFailed(reference);
    }
  }

  private async handleRefundWebhook(
    event: PaystackWebhookEvent,
  ): Promise<void> {
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
        providerAmount !== this.toPaystackAmount(refund.amount)
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

  // ---------------------------------------------------------------------------
  // USER PAYMENT
  // ---------------------------------------------------------------------------

  async findByOrder(
    userId: string,
    orderId: string,
  ): Promise<PaymentResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    const payment = await this.prisma.payment.findFirst({
      where: {
        orderId,
        userId,
      },
      include: {
        refunds: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found.');
    }

    return {
      ...this.toResponse(payment),
      refundStatus: payment.refunds[0]?.status,
    };
  }

  // ---------------------------------------------------------------------------
  // REFUND
  // ---------------------------------------------------------------------------

  async refund(
    paymentId: string,
    adminId: string,
    amount?: number,
  ): Promise<PaymentResponseDto> {
    this.assertPaystackConfigured();

    const claim = await this.prisma.$transaction(
      async (tx) => {
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
        if (amount !== undefined && !this.moneyEquals(amount, payment.amount)) {
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

        await tx.auditLog.create({
          data: {
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
          },
        });

        return { refund, shouldSubmit: true };
      },
      { timeout: 15_000 },
    );

    if (claim.shouldSubmit) await this.reconcileRefundAttempt(claim.refund.id);

    const [updated, latestRefund] = await Promise.all([
      this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
      this.prisma.paymentRefund.findUniqueOrThrow({
        where: { id: claim.refund.id },
      }),
    ]);
    return { ...this.toResponse(updated), refundStatus: latestRefund.status };
  }

  private isRefundActive(status: PaymentRefundStatus): boolean {
    return this.activeRefundStatuses().includes(status);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePendingRefunds(): Promise<void> {
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
      const lookup = await this.paystackGet<PaystackRefundListResponse>(
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
      const created = await this.paystackPost<PaystackRefundResponse>(
        'https://api.paystack.co/refund',
        {
          transaction,
          amount: this.toPaystackAmount(refund.amount),
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

    await this.prisma.$transaction(
      async (tx) => {
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
          await tx.auditLog.create({
            data: {
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
            await this.restoreOrderStock(
              tx,
              currentOrder.orderItems,
              'Stock restored after Paystack refund processed',
            );
            await tx.order.update({
              where: { id: currentOrder.id },
              data: { stockRestored: true },
            });
          }

          const vendorEarnings = this.calculateVendorEarnings(
            currentOrder.orderItems,
          );
          for (const [vendorId, earning] of vendorEarnings) {
            const credited = await tx.walletTransaction.findFirst({
              where: {
                referenceId: currentOrder.id,
                type: WalletTransactionType.CREDIT,
                reason: WalletTransactionReason.COMMISSION,
                vendorWallet: { vendorId },
              },
              select: { id: true },
            });
            if (credited) {
              await this.walletService.debitVendorPending(
                vendorId,
                earning,
                currentOrder.id,
                tx,
              );
            }
          }

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
          await tx.auditLog.create({
            data: {
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
            },
          });
          await this.outbox.appendEvent(
            tx,
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
          await tx.auditLog.create({
            data: {
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
            },
          });
        }
      },
      { timeout: 15_000 },
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
      amount !== this.toPaystackAmount(expectedAmount)
    ) {
      throw new ServiceUnavailableException(
        `Paystack refund amount does not match local attempt ${providerReference}.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // PAYMENT CONFIRMATION
  // ---------------------------------------------------------------------------

  private async confirmPayment(
    reference: string,
    webhookData?: PaystackWebhookEvent['data'],
    orderIdFallback?: string,
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
      return this.toResponse(payment);
    }

    if (payment.status === PaymentStatus.REFUNDED) {
      return this.toResponse(payment);
    }

    if (payment.status === PaymentStatus.REFUND_PENDING) {
      return this.toResponse(payment);
    }

    /**
     * Never trust unverified payload amounts directly.
     * Ask Paystack to verify the transaction.
     * If the verification API times out or is unreachable, but we have a cryptographically
     * verified webhook payload proving charge.success, use that authoritative webhook proof.
     */
    let verified = await this.paystackVerify(reference);

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

    const expectedAmount = this.toPaystackAmount(payment.amount);

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

    let orderMovedToProcessing = false;

    /**
     * The payment state transition is the concurrency gate.
     *
     * If two webhooks arrive at the same time:
     *
     * Request A: PENDING -> SUCCESS = count 1
     * Request B: PENDING -> SUCCESS = count 0
     *
     * Only Request A is allowed to credit wallets / consume the cart.
     */
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PENDING,
          },
          data: {
            status: PaymentStatus.SUCCESS,

            transactionId: String(verified.data.id ?? reference),

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
            await tx.auditLog.create({
              data: {
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
              },
            });
          }

          return currentPayment;
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

          const earnings = this.calculateVendorEarnings(order.orderItems);

          for (const [vendorId, earning] of earnings) {
            await this.walletService.creditVendorPending(
              vendorId,
              earning,
              payment.orderId,
              tx,
            );
          }
        }

        if (orderMovedToProcessing) {
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
          await this.outbox.appendEvent(
            tx,
            'payment',
            payment.id,
            RABBITMQ_ROUTING_KEYS.NOTIFICATION_DISPATCH,
            customerNotification,
          );
          await this.outbox.appendEvent(
            tx,
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
            await this.outbox.appendEvent(
              tx,
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

          const admins = await tx.admin.findMany({
            where: { isActive: true },
            select: { id: true },
          });
          for (const admin of admins) {
            await this.outbox.appendEvent(
              tx,
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

        await tx.auditLog.create({
          data: {
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
          },
        });
        return tx.payment.findUniqueOrThrow({
          where: {
            id: payment.id,
          },
        });
      },
      {
        timeout: 15_000,
      },
    );

    /**
     * Email and events are outside the transaction.
     * When payment succeeds and the order moves to PROCESSING,
     * send the official Order Confirmation email with invoice attached.
     */
    if (orderMovedToProcessing) {
      void this.invalidateCartCache(payment.userId);

      this.sendOrderConfirmationEmail(updated.id).catch((error) => {
        this.logger.error(
          `Failed to send order confirmation for ${updated.id}`,
          error,
        );
      });

      this.emitOrderProcessingEvent(updated.orderId).catch((error) => {
        this.logger.error(
          `Failed to emit processing event for ${updated.orderId}`,
          error,
        );
      });

      this.emitPaymentConfirmedEvent(updated.id).catch((error) => {
        this.logger.error(
          `Failed to emit payment confirmed event for ${updated.id}`,
          error,
        );
      });
    } else {
      this.logger.error(
        `Payment ${updated.id} was captured but order ${payment.orderId} did not move from PENDING to PROCESSING. Vendor earnings were not credited; reconciliation is required.`,
      );
    }

    return this.toResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // PAYMENT FAILED
  // ---------------------------------------------------------------------------

  private async markPaymentFailed(
    reference: string,
    reason?: string,
  ): Promise<void> {
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

    await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.PENDING,
      },
      data: {
        status: PaymentStatus.FAILED,
      },
    });

    if (payment.user && payment.order) {
      const payload: PaymentFailedPayload = {
        paymentId: payment.id,
        orderId: payment.orderId,
        orderNumber: payment.order.orderNumber,
        userId: payment.userId,
        userEmail: payment.user.email,
        userFirstName: payment.user.firstName,
        reason,
      };

      this.eventEmitter.emit(DomainEvents.PAYMENT_FAILED, payload);
    }
  }

  // ---------------------------------------------------------------------------
  // PAYSTACK HTTP
  // ---------------------------------------------------------------------------

  private async paystackVerify(
    reference: string,
  ): Promise<PaystackApiResponse<PaystackVerifyData> | null> {
    const url =
      `${PAYSTACK_TRANSACTION_VERIFY_BASE_URL}/` +
      `${encodeURIComponent(reference)}`;

    try {
      return await this.paystackGet<PaystackApiResponse<PaystackVerifyData>>(
        url,
      );
    } catch (error) {
      this.logger.error('Paystack verification request failed', error);

      return null;
    }
  }

  private async paystackPost<T>(url: string, body: unknown): Promise<T> {
    return this.circuitBreaker.executePaystack(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.paystackHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.paystackTimeoutMs),
      });

      return this.parsePaystackResponse<T>(response);
    });
  }

  private async paystackGet<T>(url: string): Promise<T> {
    return this.circuitBreaker.executePaystack(async () => {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.paystackHeaders(),
        signal: AbortSignal.timeout(this.paystackTimeoutMs),
      });

      return this.parsePaystackResponse<T>(response);
    });
  }

  private paystackHeaders(): Record<string, string> {
    const secretKey = this.config
      .getOrThrow<string>('PAYSTACK_SECRET_KEY')
      .trim();

    if (!secretKey) {
      throw new InternalServerErrorException('Paystack is not configured.');
    }

    return {
      Authorization: `Bearer ${secretKey}`,

      'Content-Type': 'application/json',
    };
  }

  private async parsePaystackResponse<T>(response: Response): Promise<T> {
    const rawText = await response.text();

    let data: T;

    try {
      data = JSON.parse(rawText) as T;
    } catch {
      this.logger.error('Paystack returned invalid JSON.');

      throw new ServiceUnavailableException('Invalid Paystack API response.');
    }

    if (!response.ok) {
      const rawMessage =
        typeof data === 'object' &&
        data !== null &&
        'message' in data &&
        typeof (
          data as {
            message?: unknown;
          }
        ).message === 'string'
          ? (
              data as {
                message: string;
              }
            ).message
          : `Paystack returned HTTP ${response.status}.`;

      const authenticationError =
        response.status === 401 ||
        response.status === 403 ||
        /invalid\s*key/i.test(rawMessage);

      if (authenticationError) {
        this.logger.error('Paystack authentication failed.');

        throw new ServiceUnavailableException(
          'Paystack authentication failed. Check PAYSTACK_SECRET_KEY.',
        );
      }

      throw new ServiceUnavailableException(rawMessage);
    }

    return data;
  }

  // ---------------------------------------------------------------------------
  // SECURITY
  // ---------------------------------------------------------------------------

  private isValidWebhookSignature(rawBody: string, signature: string): boolean {
    try {
      const secret = this.config
        .getOrThrow<string>('PAYSTACK_SECRET_KEY')
        .trim();

      const expected = createHmac(PAYSTACK_WEBHOOK_CRYPTO_ALGO, secret)
        .update(rawBody)
        .digest('hex');

      const receivedBuffer = Buffer.from(signature.trim(), 'utf8');

      const expectedBuffer = Buffer.from(expected, 'utf8');

      if (receivedBuffer.length !== expectedBuffer.length) {
        return false;
      }

      return timingSafeEqual(receivedBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  private assertPaystackConfigured(): void {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY')?.trim();

    if (!key) {
      throw new InternalServerErrorException('Paystack is not configured.');
    }
  }

  // ---------------------------------------------------------------------------
  // MONEY
  // ---------------------------------------------------------------------------

  private toPaystackAmount(amount: Prisma.Decimal): number {
    return Number(amount.toDecimalPlaces(2).mul(100));
  }

  private moneyEquals(value: number, decimal: Prisma.Decimal): boolean {
    if (!Number.isFinite(value)) {
      return false;
    }

    return new Prisma.Decimal(value).equals(decimal);
  }

  // ---------------------------------------------------------------------------
  // REFERENCE
  // ---------------------------------------------------------------------------

  private generateReference(): string {
    /**
     * UUID randomness is preferable to Math.random() for transaction
     * references.
     */
    return `nuts_${randomUUID().replace(/-/g, '')}`;
  }

  // ---------------------------------------------------------------------------
  // STOCK
  // ---------------------------------------------------------------------------

  private async restoreOrderStock(
    tx: Prisma.TransactionClient,
    orderItems: Array<{
      productId: string;
      variantId: string | null;
      quantity: number;
    }>,
    description: string,
  ): Promise<void> {
    const rows: Prisma.StockHistoryCreateManyInput[] = [];

    const sorted = [...orderItems].sort((a, b) =>
      (a.variantId ?? a.productId).localeCompare(b.variantId ?? b.productId),
    );

    for (const item of sorted) {
      if (item.variantId) {
        const result = await tx.$queryRaw<
          Array<{
            id: string;
            productId: string;
            oldStock: number;
            newStock: number;
          }>
        >(
          Prisma.sql`
              UPDATE "product_variants"
              SET
                "stock" = "stock" + ${item.quantity},
                "updatedAt" = NOW()
              WHERE "id" = ${item.variantId}
              RETURNING
                "id",
                "productId",
                ("stock" - ${item.quantity}) AS "oldStock",
                "stock" AS "newStock"
            `,
        );

        if (result.length !== 1) {
          throw new ConflictException(
            `Unable to restore stock for variant ${item.variantId}.`,
          );
        }

        rows.push({
          productId: result[0].productId,

          variantId: result[0].id,

          adjustment: item.quantity,

          oldStockQuantity: result[0].oldStock,

          newStockQuantity: result[0].newStock,

          description,
        });
      } else {
        const result = await tx.$queryRaw<
          Array<{
            id: string;
            oldStock: number;
            newStock: number;
          }>
        >(
          Prisma.sql`
              UPDATE "products"
              SET
                "stock" = "stock" + ${item.quantity},
                "updatedAt" = NOW()
              WHERE "id" = ${item.productId}
              RETURNING
                "id",
                ("stock" - ${item.quantity}) AS "oldStock",
                "stock" AS "newStock"
            `,
        );

        if (result.length !== 1) {
          throw new ConflictException(
            `Unable to restore stock for product ${item.productId}.`,
          );
        }

        rows.push({
          productId: result[0].id,

          adjustment: item.quantity,

          oldStockQuantity: result[0].oldStock,

          newStockQuantity: result[0].newStock,

          description,
        });
      }
    }

    if (rows.length) {
      await tx.stockHistory.createMany({
        data: rows,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // VENDOR EARNINGS
  // ---------------------------------------------------------------------------

  private calculateVendorEarnings(
    items: Array<{
      vendorId: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
    }>,
  ): Map<string, Prisma.Decimal> {
    const result = new Map<string, Prisma.Decimal>();

    for (const item of items) {
      const earning = item.unitPrice
        .mul(item.quantity)
        .mul(VENDOR_COMMISSION_RATE)
        .toDecimalPlaces(2);

      const current = result.get(item.vendorId) ?? new Prisma.Decimal(0);

      result.set(item.vendorId, current.add(earning).toDecimalPlaces(2));
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // RESPONSE
  // ---------------------------------------------------------------------------

  private toResponse(
    payment: Prisma.PaymentGetPayload<object>,
  ): PaymentResponseDto {
    return {
      id: payment.id,
      orderId: payment.orderId,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      transactionReference: payment.transactionReference,
      paymentLink: payment.paymentLink,
      paymentMethod: payment.paymentMethod,
      createdAt: payment.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  private async emitOrderProcessingEvent(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
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

      this.eventEmitter.emit(DomainEvents.ORDER_PROCESSING, payload);
    } catch (error) {
      this.logger.error(
        `Failed to emit ORDER_PROCESSING for ${orderId}`,
        error,
      );
    }
  }

  private async emitPaymentConfirmedEvent(paymentId: string): Promise<void> {
    try {
      const payment = await this.prisma.payment.findUnique({
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

      this.eventEmitter.emit(DomainEvents.PAYMENT_CONFIRMED, payload);
    } catch (error) {
      this.logger.error(
        `Failed to emit PAYMENT_CONFIRMED for ${paymentId}`,
        error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // PAYMENT EMAIL
  // ---------------------------------------------------------------------------

  private async sendPaymentReceiptEmail(paymentId: string): Promise<void> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: {
          id: paymentId,
        },

        include: {
          user: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
            },
          },

          order: {
            select: {
              orderNumber: true,
              shippingAddress: true,
              createdAt: true,
              totalAmount: true,
              discountAmount: true,
              discountCode: true,
              finalAmount: true,

              orderItems: {
                include: {
                  product: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!payment || !payment.user || !payment.order) {
        return;
      }

      const items = payment.order.orderItems.map((item) => ({
        productName: item.product.name,

        quantity: item.quantity,

        price: Number(item.unitPrice),
      }));

      await this.emailService.sendPaymentReceipt(payment.user.email, {
        orderNumber: payment.order.orderNumber,

        customerName:
          `${payment.user.firstName ?? ''} ${
            payment.user.lastName ?? ''
          }`.trim() || 'Valued Customer',

        customerEmail: payment.user.email,

        shippingAddress: payment.order.shippingAddress ?? '',

        totalAmount: Number(payment.order.totalAmount),

        discountAmount: Number(payment.order.discountAmount),

        discountCode: payment.order.discountCode,

        finalAmount: Number(payment.order.finalAmount),

        currency: payment.currency,

        createdAt: payment.order.createdAt,

        items,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send payment receipt for ${paymentId}`,
        error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // ORDER CONFIRMATION EMAIL (SENT ON SUCCESSFUL PAYMENT)
  // ---------------------------------------------------------------------------

  private async sendOrderConfirmationEmail(paymentId: string): Promise<void> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: {
          id: paymentId,
        },

        include: {
          user: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
            },
          },

          order: {
            select: {
              orderNumber: true,
              shippingAddress: true,
              createdAt: true,
              totalAmount: true,
              discountAmount: true,
              discountCode: true,
              finalAmount: true,

              orderItems: {
                include: {
                  product: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!payment || !payment.user || !payment.order) {
        return;
      }

      const items = payment.order.orderItems.map((item) => ({
        productName: item.product.name,

        quantity: item.quantity,

        price: Number(item.unitPrice),
      }));

      await this.emailService.sendOrderConfirmation(payment.user.email, {
        orderNumber: payment.order.orderNumber,

        customerName:
          `${payment.user.firstName ?? ''} ${
            payment.user.lastName ?? ''
          }`.trim() || 'Valued Customer',

        customerEmail: payment.user.email,

        shippingAddress: payment.order.shippingAddress ?? '',

        totalAmount: Number(payment.order.totalAmount),

        discountAmount: Number(payment.order.discountAmount),

        discountCode: payment.order.discountCode,

        finalAmount: Number(payment.order.finalAmount),

        currency: payment.currency,

        createdAt: payment.order.createdAt,

        items,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send order confirmation for ${paymentId}`,
        error,
      );
    }
  }
}
