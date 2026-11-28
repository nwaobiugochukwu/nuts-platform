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

import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';

import { randomUUID } from 'crypto';

import {} from '@api/modules/cart/services/cart.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@api/infrastructure/cache/redis.constants';
import { PaystackClientService } from './paystack-client.service';
import { PaymentConfirmationService } from './payment-confirmation.service';
import { PaymentRefundsService } from './payment-refunds.service';
import { WebhookInboxService } from './webhook-inbox.service';
import { toPaystackAmount } from '../utils/payment-money.util';
import { toPaymentResponse } from '../utils/payment-response.util';
import { OutboxService } from '@api/infrastructure/messaging/outbox/outbox.service';
import { UsersService } from '@api/modules/users/services/users.service';
import { WalletService } from '@api/modules/wallets/services/wallet.service';
import {} from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';

import {} from '@api/modules/orders/constants/order-status.constants';

import {} from '@api/infrastructure/messaging/events/domain-events.constants';

import type {} from '@api/infrastructure/messaging/events/event-payloads.types';

import {} from '@api/common/constants/commission.constants';
import {} from '@api/modules/discounts/utils/discount-funding.util';

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
    private readonly confirmation: PaymentConfirmationService,
    @Optional() private readonly cacheService?: CacheService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

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

    await this.confirmation.confirm(
      finalReference,
      undefined,
      payment.orderId,
      true,
    );

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

    const payment = await this.confirmation.confirm(normalized);

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
      await this.confirmation.confirm(
        reference,
        event.data,
        orderIdFromMetadata,
      );

      return;
    }

    if (event.event === 'charge.failed') {
      await this.confirmation.markFailed(reference);
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

  // ---------------------------------------------------------------------------
  // RESPONSE
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

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
