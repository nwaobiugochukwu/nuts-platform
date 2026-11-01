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

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';

import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

import { CART_CACHE_PREFIX } from '@api/modules/checkout/cart/cart.service';
import { CacheService } from '@api/modules/infrastructure/cache/cache.service';
import { EmailService } from '@api/modules/infrastructure/mail/email.service';
import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import { CircuitBreakerService } from '@api/modules/infrastructure/resiliency/circuit-breaker.service';
import { UsersService } from '@api/modules/users/users.service';
import { WalletService } from '@api/modules/wallet/wallet.service';

import { generateStatusNote } from '@api/modules/orders/constants/order-status.constants';

import { DomainEvents } from '@api/modules/shared/events/domain-events';

import type {
  OrderProcessingPayload,
  PaymentConfirmedPayload,
  PaymentFailedPayload,
} from '@api/modules/shared/events/event-payloads';

import { VENDOR_COMMISSION_RATE } from '@api/modules/shared/constants/commission.constants';

import {
  PAYSTACK_SUCCESS_STATUS,
  PAYSTACK_TRANSACTION_INI_URL,
  PAYSTACK_TRANSACTION_VERIFY_BASE_URL,
  PAYSTACK_WEBHOOK_CRYPTO_ALGO,
} from '@api/modules/shared/constants/payment.constants';

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

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

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
    });

    if (!payment) {
      throw new NotFoundException('Payment not found.');
    }

    return this.toResponse(payment);
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

    /**
     * We currently have no PaymentRefund table in the schema.
     *
     * Therefore we only support a full refund safely.
     *
     * Do NOT mark a payment fully REFUNDED after sending a partial refund.
     */
    const payment = await this.prisma.payment.findUnique({
      where: {
        id: paymentId,
      },
      select: {
        id: true,
        amount: true,
        status: true,
        transactionId: true,
        transactionReference: true,
        orderId: true,

        order: {
          select: {
            id: true,
            userId: true,
            status: true,
            stockRestored: true,
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

    if (!payment) {
      throw new NotFoundException('Payment not found.');
    }

    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException(
        'Only successful payments can be refunded.',
      );
    }

    /**
     * This implementation intentionally rejects partial refunds because
     * the current schema has no refundedAmount/refund records.
     */
    if (amount !== undefined && !this.moneyEquals(amount, payment.amount)) {
      throw new BadRequestException(
        'Partial refunds are not supported by the current payment schema.',
      );
    }

    if (payment.order.status === OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Refunds after delivery require the settled vendor-earnings reversal workflow.',
      );
    }

    const transaction = payment.transactionId || payment.transactionReference;

    if (!transaction) {
      throw new BadRequestException(
        'Paystack transaction reference is missing.',
      );
    }

    const refundAmount = Number(payment.amount);

    const response = await this.paystackPost<{
      status: boolean;
      message: string;
    }>('https://api.paystack.co/refund', {
      transaction,

      amount: this.toPaystackAmount(payment.amount),
    });

    if (!response.status) {
      throw new ServiceUnavailableException(
        response.message || 'Paystack refund failed.',
      );
    }

    /**
     * IMPORTANT:
     *
     * The Paystack request succeeded.
     *
     * Now we atomically claim the refund in our DB.
     *
     * If another admin request already completed the refund, count=0 and we
     * simply return the current payment.
     */
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.payment.updateMany({
          where: {
            id: paymentId,
            status: PaymentStatus.SUCCESS,
          },
          data: {
            status: PaymentStatus.REFUNDED,
          },
        });

        if (claimed.count === 0) {
          return tx.payment.findUniqueOrThrow({
            where: {
              id: paymentId,
            },
          });
        }

        const currentOrder = await tx.order.findUnique({
          where: {
            id: payment.orderId,
          },
          select: {
            id: true,
            status: true,
            stockRestored: true,
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
        });

        if (!currentOrder) {
          throw new NotFoundException(
            'Order associated with payment was not found.',
          );
        }

        /**
         * Restore stock only once.
         *
         * We check stockRestored BEFORE setting it.
         */
        if (!currentOrder.stockRestored) {
          await this.restoreOrderStock(
            tx,
            currentOrder.orderItems,
            'Stock restored after payment refund',
          );

          await tx.order.update({
            where: {
              id: currentOrder.id,
            },
            data: {
              stockRestored: true,
            },
          });
        }

        /**
         * Refund changes the business state to REFUNDED, not CANCELLED.
         */
        const previousStatus = currentOrder.status;

        await tx.order.updateMany({
          where: {
            id: currentOrder.id,
            status: {
              not: OrderStatus.REFUNDED,
            },
          },
          data: {
            status: OrderStatus.REFUNDED,
          },
        });

        await tx.orderStatusHistory.create({
          data: {
            orderId: currentOrder.id,

            fromStatus: previousStatus,

            toStatus: OrderStatus.REFUNDED,

            changedByAdminId: adminId,

            note: generateStatusNote({
              fromStatus: previousStatus,

              toStatus: OrderStatus.REFUNDED,

              changedByAdminId: adminId,

              manualNote: `Full refund of ${refundAmount} initiated.`,
            }),
          },
        });

        /**
         * Because refunds are currently restricted to orders before delivery,
         * vendor earnings are still pending.
         *
         * Therefore reverse the pending earnings.
         */
        const vendorEarnings = this.calculateVendorEarnings(
          currentOrder.orderItems,
        );

        for (const [vendorId, earning] of vendorEarnings) {
          await this.walletService.debitVendorPending(
            vendorId,
            earning,
            currentOrder.id,
            tx,
          );
        }

        await tx.auditLog.create({
          data: {
            action: 'PAYMENT_REFUNDED',
            entity: 'PAYMENT',
            entityId: paymentId,
            adminId,
            payload: { orderId: payment.orderId, amount: refundAmount },
          },
        });
        return tx.payment.findUniqueOrThrow({
          where: {
            id: paymentId,
          },
        });
      },
      {
        timeout: 15_000,
      },
    );

    return this.toResponse(updated);
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
          return tx.payment.findUniqueOrThrow({
            where: {
              id: payment.id,
            },
          });
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
            orderItems: {
              select: {
                vendorId: true,
                quantity: true,
                unitPrice: true,
              },
            },
          },
        });

        if (order) {
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

        // Transactional Outbox Pattern: Commit domain event atomically with payment SUCCESS
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'ORDER',
            aggregateId: payment.orderId,
            eventType: 'order.confirmed',
            payload: {
              orderId: payment.orderId,
              paymentId: payment.id,
              userId: payment.userId,
              amount: Number(payment.amount),
              currency: payment.currency,
              transactionReference: reference,
              title: 'Order Confirmed',
              message: `Payment confirmed for order ${order?.orderNumber ?? payment.orderId}.`,
            },
            status: 'PENDING',
          },
        });

        await tx.auditLog.create({
          data: {
            action: 'PAYMENT_CONFIRMED',
            entity: 'PAYMENT',
            entityId: payment.id,
            userId: payment.userId,
            payload: {
              orderId: payment.orderId,
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
      this.sendPaymentReceiptEmail(updated.id).catch((error) => {
        this.logger.error(
          `Failed to send payment receipt for ${updated.id}`,
          error,
        );
      });
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
