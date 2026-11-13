import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationPriority, NotificationType, ROLE } from '@prisma/client';
import {
  EmailOrderItem,
  EmailTemplatesService,
} from '@api/infrastructure/mail/email-templates.service';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { OutboxService } from '@api/infrastructure/outbox/outbox.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { RABBITMQ_ROUTING_KEYS } from '@api/infrastructure/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/rabbitmq/rabbitmq.service';
import { NotificationsService } from '../notifications.service';
import { DomainEvents } from '@api/common/events/domain-events';
import { getErrorMessage } from '@api/common/utils/error-details.util';
import {
  NotificationPreferencesService,
  NotificationCategory,
} from '../preferences/preferences.service';
import type {
  OrderCancelledPayload,
  OrderDeliveredPayload,
  OrderProcessingPayload,
  OrderShippedPayload,
  PaymentConfirmedPayload,
  PaymentFailedPayload,
  ReferralRewardCreditedPayload,
} from '@api/common/events/event-payloads';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly outbox: OutboxService,
    private readonly emailService: EmailService,
    private readonly emailTemplates: EmailTemplatesService,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    @Optional()
    private readonly preferencesService?: NotificationPreferencesService,
  ) {}

  /**
   * Dispatches email via RabbitMQ work queue with seamless fallback to direct
   * circuit-breaker protected EmailService if RabbitMQ is offline or backpressured.
   * Respects user email notification preferences and category opt-outs.
   */
  private async dispatchEmail(data: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    type?: string;
    userId?: string;
    role?: ROLE;
    category?: NotificationCategory;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (data.userId && data.category && this.preferencesService) {
      const canSend = await this.preferencesService.canSend(
        data.userId,
        data.role ?? ROLE.USER,
        'email',
        data.category,
      );
      if (!canSend) {
        this.logger.debug(
          `Skipping email delivery to ${data.to}: opted out of ${data.category}`,
        );
        return;
      }
    }

    const published = await this.rabbitmq.publish(
      RABBITMQ_ROUTING_KEYS.EMAIL_DISPATCH,
      data,
    );
    if (!published) {
      try {
        await this.emailService.sendEmail({
          to: data.to,
          subject: data.subject,
          html: data.html,
          text: data.text,
        });
      } catch (error) {
        this.logger.error(
          `Fallback direct email delivery to ${data.to} failed: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  /**
   * Dispatches in-app notification to RabbitMQ for single-execution consumer processing.
   * Seamlessly falls back to direct notificationsService persistence if RabbitMQ is offline.
   */
  private async dispatchNotification(data: {
    userId: string;
    role: ROLE;
    type: NotificationType;
    title: string;
    message: string;
    priority: NotificationPriority;
    link?: string;
    metadata?: Record<string, unknown>;
    dedupeKey?: string;
  }): Promise<void> {
    try {
      await this.prisma.$transaction((tx) =>
        this.outbox.appendEvent(
          tx,
          'notification',
          data.dedupeKey || data.userId,
          RABBITMQ_ROUTING_KEYS.NOTIFICATION_DISPATCH,
          data,
        ),
      );
    } catch (error) {
      this.logger.error(
        `Durable notification enqueue failed for user ${data.userId}: ${getErrorMessage(error)}`,
      );
      // Preserve the database-backed fallback if the outbox table itself is unavailable.
      try {
        await this.notificationsService.create(data);
      } catch (fallbackError) {
        this.logger.error(
          `Fallback notification persistence failed for user ${data.userId}: ${getErrorMessage(fallbackError)}`,
        );
      }
    }
  }

  private formatVariantOptions(
    options: unknown,
  ): { name: string; value: string }[] | undefined {
    if (!options) return undefined;
    if (Array.isArray(options)) {
      return options as { name: string; value: string }[];
    }
    if (typeof options === 'object' && options !== null) {
      return Object.entries(options as Record<string, string>).map(
        ([name, value]) => ({ name, value }),
      );
    }
    return undefined;
  }

  @OnEvent(DomainEvents.ORDER_PROCESSING)
  async handleOrderProcessing(payload: OrderProcessingPayload): Promise<void> {
    this.logger.log(
      { orderId: payload.orderId },
      'Order processing event received',
    );

    // 1. Email to customer
    const items: EmailOrderItem[] = payload.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      variantOptions: item.variantOptions,
    }));

    const customerHtml = this.emailTemplates.orderConfirmation({
      orderNumber: payload.orderNumber,
      customerName: payload.userFirstName || 'Valued Customer',
      items,
      totalAmount: payload.totalAmount,
      discountAmount: 0,
      finalAmount: payload.finalAmount,
      currency: payload.currency,
      shippingAddress: payload.shippingAddress,
    });

    await this.dispatchEmail({
      to: payload.userEmail,
      subject: `Order Confirmation - ${payload.orderNumber}`,
      html: customerHtml,
      type: 'order_confirmation',
      userId: payload.userId,
      role: ROLE.USER,
      category: 'orderUpdates',
      metadata: { orderId: payload.orderId },
    });

    // In-app notification to customer with dedupe key
    await this.dispatchNotification({
      userId: payload.userId,
      role: ROLE.USER,
      type: NotificationType.ORDER_CONFIRMED,
      title: 'Order Confirmed',
      message: `Your order #${payload.orderNumber} is now processing.`,
      priority: NotificationPriority.HIGH,
      link: `/order/${payload.orderId}`,
      metadata: { orderId: payload.orderId },
      dedupeKey: `ORDER_CONFIRMED:${payload.orderId}:USER:${payload.userId}`,
    });

    // 2. Fetch order items for per-vendor notifications
    const orderItems = await this.prisma.orderItem.findMany({
      where: { orderId: payload.orderId },
      include: {
        product: { select: { name: true } },
        variant: { select: { options: true } },
        vendor: { select: { id: true, email: true, storeName: true } },
      },
    });

    if (orderItems && orderItems.length > 0) {
      const vendorItemsMap = new Map<string, typeof orderItems>();
      for (const item of orderItems) {
        const existing = vendorItemsMap.get(item.vendorId) || [];
        existing.push(item);
        vendorItemsMap.set(item.vendorId, existing);
      }

      await Promise.allSettled(
        Array.from(vendorItemsMap.entries()).map(async ([, vendorItems]) => {
          try {
            const vendor = vendorItems[0].vendor;
            const vendorTotal = vendorItems.reduce(
              (sum: number, i) => sum + Number(i.totalPrice),
              0,
            );

            const vendorOrderItems: EmailOrderItem[] = vendorItems.map(
              (item) => ({
                productName: item.product.name,
                quantity: item.quantity,
                unitPrice: Number(item.unitPrice),
                totalPrice: Number(item.totalPrice),
                variantOptions: item.variant
                  ? this.formatVariantOptions(item.variant.options)
                  : undefined,
              }),
            );

            const vendorHtml = this.emailTemplates.newOrderForVendor({
              vendorStoreName: vendor.storeName,
              orderNumber: payload.orderNumber,
              customerName: payload.userFirstName || 'Customer',
              items: vendorOrderItems,
              totalAmount: vendorTotal,
              orderTotalForVendor: vendorTotal,
              currency: payload.currency,
            });

            await this.dispatchEmail({
              to: vendor.email,
              subject: `New Order Received - ${payload.orderNumber}`,
              html: vendorHtml,
              type: 'vendor_new_order',
              userId: vendor.id,
              role: ROLE.VENDOR,
              category: 'orderUpdates',
              metadata: { orderId: payload.orderId, vendorId: vendor.id },
            });

            await this.dispatchNotification({
              userId: vendor.id,
              role: ROLE.VENDOR,
              type: NotificationType.ORDER_CONFIRMED,
              title: 'New Order Received',
              message: `You have received a new sale for order #${payload.orderNumber}.`,
              priority: NotificationPriority.HIGH,
              link: `/vendor/order/${payload.orderId}`,
              metadata: {
                orderId: payload.orderId,
                orderNumber: payload.orderNumber,
              },
              dedupeKey: `ORDER_CONFIRMED:${payload.orderId}:VENDOR:${vendor.id}`,
            });
          } catch (vendorErr) {
            this.logger.error(
              `Failed notifying vendor for order ${payload.orderId}: ${getErrorMessage(vendorErr)}`,
            );
          }
        }),
      );
    }

    // 3. Notify all active platform Admins concurrently
    try {
      const admins = await this.prisma.admin.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      await Promise.allSettled(
        admins.map((admin) =>
          this.dispatchNotification({
            userId: admin.id,
            role: ROLE.ADMIN,
            type: NotificationType.ORDER_PLACED,
            title: 'New Order Received',
            message: `Order #${payload.orderNumber} placed for ${payload.currency} ${payload.finalAmount || payload.totalAmount}.`,
            priority: NotificationPriority.HIGH,
            link: `/admin/order/${payload.orderId}`,
            metadata: {
              orderId: payload.orderId,
              orderNumber: payload.orderNumber,
            },
            dedupeKey: `ORDER_PLACED:${payload.orderId}:ADMIN:${admin.id}`,
          }),
        ),
      );
    } catch (err) {
      this.logger.error('Failed to notify admins of new order', err);
    }
  }

  @OnEvent(DomainEvents.ORDER_SHIPPED)
  async handleOrderShipped(payload: OrderShippedPayload): Promise<void> {
    this.logger.log(
      { orderId: payload.orderId },
      'Order shipped event received',
    );

    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: {
        orderItems: {
          include: {
            product: { select: { name: true } },
            variant: { select: { options: true } },
          },
        },
      },
    });

    if (!order) return;

    const payment = await this.prisma.payment.findFirst({
      where: { orderId: payload.orderId },
      select: { currency: true },
    });

    const items: EmailOrderItem[] = order.orderItems.map((item) => ({
      productName: item.product.name,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      variantOptions: item.variant
        ? this.formatVariantOptions(item.variant.options)
        : undefined,
    }));

    const html = this.emailTemplates.orderShipped({
      orderNumber: payload.orderNumber,
      customerName: payload.userFirstName || 'Valued Customer',
      items,
      trackingNumber: payload.trackingNumber,
      shippingAddress: order.shippingAddress || '',
      currency: payment?.currency || 'NGN',
    });

    await this.dispatchEmail({
      to: payload.userEmail,
      subject: `Your Order #${payload.orderNumber} Has Shipped!`,
      html,
      type: 'order_shipped',
      userId: payload.userId,
      role: ROLE.USER,
      category: 'orderUpdates',
      metadata: { orderId: payload.orderId },
    });

    await this.dispatchNotification({
      userId: payload.userId,
      role: ROLE.USER,
      type: NotificationType.ORDER_SHIPPED,
      title: 'Order Shipped',
      message: `Your order #${payload.orderNumber} is on the way.`,
      priority: NotificationPriority.HIGH,
      link: `/order/${payload.orderId}`,
      metadata: { orderId: payload.orderId },
      dedupeKey: `ORDER_SHIPPED:${payload.orderId}:USER:${payload.userId}`,
    });
  }

  @OnEvent(DomainEvents.ORDER_DELIVERED)
  async handleOrderDelivered(payload: OrderDeliveredPayload): Promise<void> {
    this.logger.log(
      { orderId: payload.orderId },
      'Order delivered event received',
    );

    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: {
        orderItems: {
          include: {
            product: { select: { name: true } },
            variant: { select: { options: true } },
          },
        },
      },
    });

    if (!order) return;

    const payment = await this.prisma.payment.findFirst({
      where: { orderId: payload.orderId },
      select: { currency: true },
    });

    const items: EmailOrderItem[] = order.orderItems.map((item) => ({
      productName: item.product.name,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      variantOptions: item.variant
        ? this.formatVariantOptions(item.variant.options)
        : undefined,
    }));

    const html = this.emailTemplates.orderDelivered({
      orderNumber: payload.orderNumber,
      customerName: payload.userFirstName || 'Valued Customer',
      items,
      currency: payment?.currency || 'NGN',
    });

    await this.dispatchEmail({
      to: payload.userEmail,
      subject: `Order Delivered - ${payload.orderNumber}`,
      html,
      type: 'order_delivered',
      userId: payload.userId,
      role: ROLE.USER,
      category: 'orderUpdates',
      metadata: { orderId: payload.orderId },
    });

    await this.dispatchNotification({
      userId: payload.userId,
      role: ROLE.USER,
      type: NotificationType.ORDER_DELIVERED,
      title: 'Order Delivered',
      message: `Your order #${payload.orderNumber} has been delivered.`,
      priority: NotificationPriority.HIGH,
      link: `/order/${payload.orderId}`,
      metadata: { orderId: payload.orderId },
      dedupeKey: `ORDER_DELIVERED:${payload.orderId}:USER:${payload.userId}`,
    });
  }

  @OnEvent(DomainEvents.ORDER_CANCELLED)
  async handleOrderCancelled(payload: OrderCancelledPayload): Promise<void> {
    this.logger.log(
      { orderId: payload.orderId },
      'Order cancelled event received',
    );

    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: {
        orderItems: {
          include: {
            product: { select: { name: true } },
            variant: { select: { options: true } },
          },
        },
      },
    });

    if (!order) return;

    const payment = await this.prisma.payment.findFirst({
      where: { orderId: payload.orderId },
      select: { currency: true },
    });

    const items: EmailOrderItem[] = order.orderItems.map((item) => ({
      productName: item.product.name,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      variantOptions: item.variant
        ? this.formatVariantOptions(item.variant.options)
        : undefined,
    }));

    const html = this.emailTemplates.orderCancelled({
      orderNumber: payload.orderNumber,
      customerName: payload.userFirstName || 'Valued Customer',
      items,
      reason: payload.reason,
      refundProcessed: payload.refundProcessed,
      currency: payment?.currency || 'NGN',
    });

    await this.dispatchEmail({
      to: payload.userEmail,
      subject: `Order #${payload.orderNumber} Cancelled`,
      html,
      type: 'order_cancelled',
      userId: payload.userId,
      role: ROLE.USER,
      category: 'orderUpdates',
      metadata: { orderId: payload.orderId },
    });

    await this.dispatchNotification({
      userId: payload.userId,
      role: ROLE.USER,
      type: NotificationType.ORDER_CANCELLED,
      title: 'Order Cancelled',
      message: `Your order #${payload.orderNumber} has been cancelled.`,
      priority: NotificationPriority.HIGH,
      link: `/order/${payload.orderId}`,
      metadata: { orderId: payload.orderId },
      dedupeKey: `ORDER_CANCELLED:${payload.orderId}:USER:${payload.userId}`,
    });
  }

  @OnEvent(DomainEvents.PAYMENT_CONFIRMED)
  async handlePaymentConfirmed(
    payload: PaymentConfirmedPayload,
  ): Promise<void> {
    this.logger.log(
      { paymentId: payload.paymentId },
      'Payment confirmed event received',
    );

    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: {
        orderItems: {
          include: {
            product: { select: { name: true } },
            variant: { select: { options: true } },
          },
        },
      },
    });

    if (!order) return;

    const items: EmailOrderItem[] = order.orderItems.map((item) => ({
      productName: item.product.name,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      variantOptions: item.variant
        ? this.formatVariantOptions(item.variant.options)
        : undefined,
    }));

    const html = this.emailTemplates.paymentConfirmed({
      orderNumber: payload.orderNumber,
      customerName: payload.userFirstName || 'Valued Customer',
      items,
      amount: payload.amount,
      currency: payload.currency,
      paymentReference: payload.paymentReference,
    });

    await this.dispatchEmail({
      to: payload.userEmail,
      subject: `Payment Confirmed - Order #${payload.orderNumber}`,
      html,
      type: 'payment_confirmed',
      userId: payload.userId,
      role: ROLE.USER,
      category: 'paymentAlerts',
      metadata: { paymentId: payload.paymentId, orderId: payload.orderId },
    });

    await this.dispatchNotification({
      userId: payload.userId,
      role: ROLE.USER,
      type: NotificationType.PAYMENT_RECEIVED,
      title: 'Payment Successful',
      message: `Payment of ${payload.currency} ${payload.amount} confirmed for order #${payload.orderNumber}.`,
      priority: NotificationPriority.HIGH,
      link: `/order/${payload.orderId}`,
      metadata: { paymentId: payload.paymentId, orderId: payload.orderId },
      dedupeKey: `PAYMENT_RECEIVED:${payload.paymentId}:USER:${payload.userId}`,
    });

    // Notify all active Admins of confirmed payment concurrently
    try {
      const admins = await this.prisma.admin.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      await Promise.allSettled(
        admins.map((admin) =>
          this.dispatchNotification({
            userId: admin.id,
            role: ROLE.ADMIN,
            type: NotificationType.PAYMENT_RECEIVED,
            title: 'Payment Confirmed',
            message: `Payment of ${payload.currency} ${payload.amount} confirmed for order #${payload.orderNumber}.`,
            priority: NotificationPriority.MEDIUM,
            link: `/admin/order/${payload.orderId}`,
            metadata: {
              paymentId: payload.paymentId,
              orderId: payload.orderId,
              orderNumber: payload.orderNumber,
            },
            dedupeKey: `PAYMENT_RECEIVED:${payload.paymentId}:ADMIN:${admin.id}`,
          }),
        ),
      );
    } catch (err) {
      this.logger.error('Failed to notify admins of confirmed payment', err);
    }
  }

  @OnEvent(DomainEvents.PAYMENT_FAILED)
  async handlePaymentFailed(payload: PaymentFailedPayload): Promise<void> {
    this.logger.log(
      { paymentId: payload.paymentId },
      'Payment failed event received',
    );

    const html = this.emailTemplates.paymentFailed({
      orderNumber: payload.orderNumber,
      customerName: payload.userFirstName || 'Valued Customer',
      reason: payload.reason,
    });

    await this.dispatchEmail({
      to: payload.userEmail,
      subject: `Payment Failed - Order #${payload.orderNumber}`,
      html,
      type: 'payment_failed',
      userId: payload.userId,
      role: ROLE.USER,
      category: 'paymentAlerts',
      metadata: { paymentId: payload.paymentId },
    });

    await this.dispatchNotification({
      userId: payload.userId,
      role: ROLE.USER,
      type: NotificationType.PAYMENT_FAILED,
      title: 'Payment Failed',
      message: `Payment failed for order #${payload.orderNumber}: ${payload.reason || 'Check details and try again.'}`,
      priority: NotificationPriority.HIGH,
      link: `/checkout`,
      metadata: { paymentId: payload.paymentId, orderId: payload.orderId },
      dedupeKey: `PAYMENT_FAILED:${payload.paymentId}:USER:${payload.userId}`,
    });
  }

  @OnEvent(DomainEvents.REFERRAL_REWARD_CREDITED)
  async handleReferralReward(
    payload: ReferralRewardCreditedPayload,
  ): Promise<void> {
    this.logger.log(
      { referralId: payload.referralId },
      'Referral reward event received',
    );

    const currency = (payload as { currency?: string }).currency || 'NGN';

    const html = this.emailTemplates.referralRewardCredited({
      referrerName: payload.referrerName,
      rewardAmount: payload.rewardAmount,
      currency,
    });

    await this.dispatchEmail({
      to: payload.referrerEmail,
      subject: 'You Earned a Referral Reward!',
      html,
      type: 'referral_reward',
      userId: payload.referrerId,
      role: ROLE.USER,
      category: 'marketingPromos',
      metadata: { referralId: payload.referralId },
    });

    await this.dispatchNotification({
      userId: payload.referrerId,
      role: ROLE.USER,
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Referral Reward Credited',
      message: `A referral reward of ${currency} ${payload.rewardAmount} has been credited to your account.`,
      priority: NotificationPriority.MEDIUM,
      link: `/wallet`,
      metadata: { referralId: payload.referralId },
      dedupeKey: `SYSTEM_ANNOUNCEMENT:referral:${payload.referralId}:USER:${payload.referrerId}`,
    });
  }
}
