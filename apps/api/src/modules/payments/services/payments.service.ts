import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import {
  NotificationPriority,
  NotificationType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ROLE,
} from '@prisma/client';

import { randomUUID } from 'crypto';

import { CART_CACHE_PREFIX } from '@api/modules/cart/services/cart.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@api/infrastructure/cache/redis.constants';
import { PaystackClientService } from './paystack-client.service';
import { PaymentRefundsService } from './payment-refunds.service';
import { WebhookInboxService } from './webhook-inbox.service';
import { toPaystackAmount } from '../utils/payment-money.util';
import { toPaymentResponse } from '../utils/payment-response.util';
import { OutboxService } from '@api/infrastructure/messaging/outbox/outbox.service';
import { UsersService } from '@api/modules/users/services/users.service';
import { WalletService } from '@api/modules/wallets/services/wallet.service';
import { RABBITMQ_ROUTING_KEYS } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';

import { generateStatusNote } from '@api/modules/orders/constants/order-status.constants';

import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';

import type {
  OrderProcessingPayload,
  PaymentConfirmedPayload,
  PaymentFailedPayload,
} from '@api/infrastructure/messaging/events/event-payloads.types';

import { VENDOR_COMMISSION_RATE } from '@api/common/constants/commission.constants';
import {
  computeVendorEarnings,
  loadVendorFundedDiscounts,
} from '@api/modules/discounts/utils/discount-funding.util';

import {
  PAYSTACK_SUCCESS_STATUS,
  PAYSTACK_TRANSACTION_INI_URL,
} from '@api/common/constants/payment.constants';

import {
  InitializePaymentResponseDto,
  PaymentResponseDto,
} from '../dto/payment-response.dto';

import type {
  PaystackApiResponse,
  PaystackInitializeData,
  PaystackInitializePayload,
  PaystackWebhookEvent,
} from '../types/paystack.types';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly walletService: WalletService,
    private readonly paystack: PaystackClientService,
    private readonly outbox: OutboxService,
    private readonly webhookInbox: WebhookInboxService,
    private readonly refunds: PaymentRefundsService,
    @Optional() private readonly cacheService?: CacheService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
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

    this.paystack.assertConfigured();

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

    if (new Prisma.Decimal(payment.amount).isZero()) {
      return this.settleZeroTotalOrder({
        id: payment.id,
        orderId: payment.order.id,
        transactionReference: payment.transactionReference,
      });
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

    const amountKobo = toPaystackAmount(payment.amount);

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

    const callbackUrl = this.resolveCallbackUrl();

    if (callbackUrl) {
      payload.callback_url = callbackUrl;
    }

    const result = await this.paystack.post<
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

  private resolveCallbackUrl(): string | undefined {
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
    return configuredCallback || fallbackCallback;
  }

  /**
   * An order whose total is exactly zero (a 100% discount) has nothing to
   * charge, and Paystack rejects zero-amount transactions. Settle it through
   * the same confirmation path as a paid order so stock, vendor earnings,
   * notifications and cart handling all behave identically.
   *
   * Only reachable when the SERVER-SIDE payment amount is zero.
   */
  private async settleZeroTotalOrder(payment: {
    id: string;
    orderId: string;
    transactionReference: string | null;
  }): Promise<InitializePaymentResponseDto> {
    const reference = payment.transactionReference ?? `FREE-${randomUUID()}`;

    if (!payment.transactionReference) {
      await this.prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.PENDING,
          transactionReference: null,
        },
        data: { transactionReference: reference, paymentMethod: 'discount' },
      });
    }

    const stored = await this.prisma.payment.findUnique({
      where: { id: payment.id },
      select: { transactionReference: true },
    });
    const finalReference = stored?.transactionReference ?? reference;

    await this.confirmPayment(finalReference, undefined, payment.orderId, true);

    const callback = this.resolveCallbackUrl();
    const separator = callback?.includes('?') ? '&' : '?';
    return {
      authorizationUrl: callback
        ? `${callback}${separator}reference=${encodeURIComponent(finalReference)}`
        : `/order/${payment.orderId}`,
      reference: finalReference,
      paymentId: payment.id,
    };
  }

  // ---------------------------------------------------------------------------
  // CALLBACK / VERIFICATION
  // ---------------------------------------------------------------------------

  async verifyByReference(reference: string): Promise<PaymentResponseDto> {
    this.paystack.assertConfigured();

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

  /**
   * What the webhook endpoint does: check the signature, then store the event once and queue it
   * (the webhook inbox). Paystack gets its 200 as soon as the event is safely stored; the work
   * happens from the queue, with retries, in `processWebhookEvent`.
   */
  async receiveWebhook(
    rawBody: string,
    signature: string | undefined,
  ): Promise<void> {
    const event = this.verifyWebhook(rawBody, signature);
    const { duplicate } = await this.webhookInbox.receive({
      provider: 'paystack',
      eventType: event.event,
      rawBody,
    });
    if (duplicate) {
      this.logger.log(`Paystack webhook ${event.event} was already received.`);
    }
  }

  /** Verifies the signature and returns the parsed event; throws 400 on anything invalid. */
  verifyWebhook(
    rawBody: string,
    signature: string | undefined,
  ): PaystackWebhookEvent {
    this.paystack.assertConfigured();

    if (
      !signature ||
      !this.paystack.isValidWebhookSignature(rawBody, signature)
    ) {
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
    return event;
  }

  /** Applies a verified webhook event. Called by the webhook consumer, never by the endpoint. */
  async processWebhookEvent(event: PaystackWebhookEvent): Promise<void> {
    if (event.event.startsWith('refund.')) {
      await this.refunds.handleWebhook(event);
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
      ...toPaymentResponse(payment),
      refundStatus: payment.refunds[0]?.status,
    };
  }

  // ---------------------------------------------------------------------------
  // REFUND
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // PAYMENT CONFIRMATION
  // ---------------------------------------------------------------------------

  private async confirmPayment(
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

    /**
     * Never trust unverified payload amounts directly.
     * Ask Paystack to verify the transaction.
     * If the verification API times out or is unreachable, but we have a cryptographically
     * verified webhook payload proving charge.success, use that authoritative webhook proof.
     */
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
          await this.publishOrderProcessingEvent(tx, payment.orderId);
          await this.publishPaymentConfirmedEvent(tx, payment.id);

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

      // The order.processing and payment.confirmed events were written to the outbox in the
      // transaction above; wake the relay now that it has committed.
      this.outbox.wakeRelay();
    } else {
      this.logger.error(
        `Payment ${updated.id} was captured but order ${payment.orderId} did not move from PENDING to PROCESSING. Vendor earnings were not credited; reconciliation is required.`,
      );
    }

    return toPaymentResponse(updated);
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

    // The status change and the payment.failed event commit together: only the delivery that
    // actually moved the payment from PENDING to FAILED publishes the event.
    await this.prisma.$transaction(async (tx) => {
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
      await this.outbox.appendEnvelope(
        tx,
        {
          type: DomainEvents.PAYMENT_FAILED,
          aggregate: { type: 'payment', id: payment.id },
          payload,
        },
        { wakeRelay: false },
      );
    });
    this.outbox.wakeRelay();
  }

  // ---------------------------------------------------------------------------
  // PAYSTACK HTTP
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // MONEY
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // VENDOR EARNINGS
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // RESPONSE
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  private async publishOrderProcessingEvent(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const order = await tx.order.findUnique({
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

    await this.outbox.appendEnvelope(
      tx,
      {
        type: DomainEvents.ORDER_PROCESSING,
        aggregate: { type: 'order', id: orderId },
        payload,
      },
      { wakeRelay: false },
    );
  }

  private async publishPaymentConfirmedEvent(
    tx: Prisma.TransactionClient,
    paymentId: string,
  ): Promise<void> {
    const payment = await tx.payment.findUnique({
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

    await this.outbox.appendEnvelope(
      tx,
      {
        type: DomainEvents.PAYMENT_CONFIRMED,
        aggregate: { type: 'payment', id: paymentId },
        payload,
      },
      { wakeRelay: false },
    );
  }

  // ---------------------------------------------------------------------------
  // ORDER CONFIRMATION EMAIL (SENT ON SUCCESSFUL PAYMENT)
  // ---------------------------------------------------------------------------

  /**
   * Sends the order confirmation email with the PDF invoice. Called by
   * `OrderConfirmationEmailConsumer` for each `payment.confirmed` event; a failure is thrown so
   * the queue retries it (a redelivery of the same event is skipped by the consumer).
   */
  async sendOrderConfirmationEmail(paymentId: string): Promise<void> {
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
      // Thrown, not swallowed: the consumer that calls this retries it, then dead-letters it.
      this.logger.error(
        `Failed to send order confirmation for ${paymentId}`,
        error,
      );
      throw error;
    }
  }
}
