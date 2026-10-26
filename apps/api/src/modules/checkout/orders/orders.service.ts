import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';

import { CacheService } from '@api/modules/infrastructure/cache/cache.service';
import { CART_CACHE_PREFIX } from '@api/modules/checkout/cart/cart.service';
import { EmailService } from '@api/modules/infrastructure/mail/email.service';
import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import { PaymentsService } from '@api/modules/payments/payments.service';
import { DiscountCodeService } from '@api/modules/promotions/discount-code.service';
import { ReferralService } from '@api/modules/referral/referral.service';
import { AuditLogService } from '@api/modules/shared/audit-log/audit-log.service';
import { UsersService } from '@api/modules/users/users.service';
import { WalletService } from '@api/modules/wallet/wallet.service';

import { AdminOrderResponseDto } from './dto/admin-order-response.dto';
import { CheckoutResponseDto } from './dto/checkout-response.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { VendorOrderResponseDto } from './dto/vendor-order-response.dto';

import { PaginationQueryDto } from '@api/modules/shared/dto/pagination-query.dto';
import { createPaginationMeta } from '@api/modules/shared/utils/pagination-meta.util';
import { getPagination } from '@api/modules/shared/utils/pagination.util';

import { CHECKOUT_IDEMPOTENCY_TTL_HOURS } from '@api/modules/shared/constants/checkout.constants';
import { UNPAID_ORDER_EXPIRATION } from '@api/modules/shared/constants';
import {
  InsufficientStockException,
  type StockShortfallItem,
} from '@api/modules/shared/errors/insufficient-stock.exception';

import {
  assertValidOrderTransition,
  generateStatusNote,
  shouldRestoreStock,
} from './constants/order-status.constants';

import { VENDOR_COMMISSION_RATE } from '@api/modules/shared/constants/commission.constants';

import { DomainEvents } from '@api/modules/shared/events/domain-events';

import type {
  OrderCancelledPayload,
  OrderDeliveredPayload,
  OrderShippedPayload,
} from '@api/modules/shared/events/event-payloads';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const jsonValueLabel = (value: unknown): string => {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value == null) return '';
  return JSON.stringify(value) ?? '';
};

/**
 * Fields needed by the normal customer order endpoints.
 *
 * Keep this intentionally small.
 * Returning every column from Product/User/etc. increases DB work and
 * response serialization cost.
 */
const orderInclude = {
  orderItems: {
    include: {
      product: {
        select: {
          name: true,
          slug: true,
          sku: true,
        },
      },
      variant: {
        select: {
          id: true,
          options: true,
        },
      },
    },
  },

  payment: {
    select: {
      id: true,
      status: true,
      paymentLink: true,
      transactionReference: true,
    },
  },
} satisfies Prisma.OrderInclude;

/**
 * Lighter relation graph for order lists.
 *
 * Payment information is deliberately omitted because the list endpoint
 * doesn't need Paystack references or payment links.
 */
const orderListInclude = {
  orderItems: {
    include: {
      product: {
        select: {
          name: true,
          slug: true,
          sku: true,
        },
      },
      variant: {
        select: {
          id: true,
          options: true,
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

/**
 * Status history is capped.
 *
 * An order can theoretically accumulate hundreds/thousands of history rows.
 * Returning all of them on every request is unnecessary.
 */
const statusHistoryInclude = {
  orderBy: {
    createdAt: 'desc' as const,
  },
  take: 50,
  include: {
    changedByUser: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    },
    changedByVendor: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    },
    changedByAdmin: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    },
  },
};

const vendorOrderInclude = {
  orderItems: {
    include: {
      product: {
        select: {
          name: true,
          slug: true,
          sku: true,
        },
      },
      variant: {
        select: {
          id: true,
          options: true,
        },
      },
    },
  },

  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  },

  statusHistory: statusHistoryInclude,
} satisfies Prisma.OrderInclude;

const vendorOrderListInclude = {
  orderItems: {
    include: {
      product: {
        select: {
          name: true,
          slug: true,
          sku: true,
        },
      },
      variant: {
        select: {
          id: true,
          options: true,
        },
      },
    },
  },

  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  },

  statusHistory: statusHistoryInclude,
} satisfies Prisma.OrderInclude;

const adminOrderInclude = {
  orderItems: {
    include: {
      product: {
        select: {
          name: true,
          slug: true,
          sku: true,
        },
      },
      variant: {
        select: {
          id: true,
          options: true,
        },
      },
    },
  },

  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  },

  payment: {
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      transactionId: true,
      transactionReference: true,
    },
  },

  statusHistory: statusHistoryInclude,
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{
  include: typeof orderInclude;
}>;

type OrderWithItemsList = Prisma.OrderGetPayload<{
  include: typeof orderListInclude;
}>;

type VendorOrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof vendorOrderInclude;
}>;

type VendorOrderWithRelationsList = Prisma.OrderGetPayload<{
  include: typeof vendorOrderListInclude;
}>;

type AdminOrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof adminOrderInclude;
}>;

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  private readonly revalidatePrices: boolean;
  private readonly defaultCurrency: string;

  /**
   * Short human-readable order suffix.
   *
   * The database's @unique constraint remains the final authority.
   * If an extremely unlikely collision occurs, the transaction fails safely.
   */
  private readonly generateOrderId = customAlphabet(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    8,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly discountCodeService: DiscountCodeService,
    private readonly referralService: ReferralService,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailService,
    private readonly auditLog: AuditLogService,
    private readonly walletService: WalletService,
    private readonly eventEmitter: EventEmitter2,
    config: ConfigService,
    @Optional() private readonly cacheService?: CacheService,
  ) {
    this.revalidatePrices =
      config.getOrThrow<string>('CHECKOUT_REVALIDATE_PRICES') !== 'false';

    this.defaultCurrency = config
      .getOrThrow<string>('DEFAULT_CURRENCY')
      .trim()
      .toLowerCase();
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

  // ---------------------------------------------------------------------------
  // CHECKOUT
  // ---------------------------------------------------------------------------

  async checkout(
    userId: string,
    dto: CheckoutDto,
    addressId: string | undefined,
    idempotencyKey: string,
  ): Promise<CheckoutResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    const key = idempotencyKey?.trim();

    if (!key) {
      throw new BadRequestException(
        'Idempotency-Key header is required for checkout.',
      );
    }

    if (key.length > 255) {
      throw new BadRequestException(
        'Idempotency-Key must not exceed 255 characters.',
      );
    }

    const normalizedAddressId = addressId?.trim() || undefined;

    const hasAddressId = Boolean(normalizedAddressId);
    const hasInlineAddress = Boolean(dto.shippingAddress);

    if (hasAddressId && hasInlineAddress) {
      throw new BadRequestException(
        'Provide either addressId or shippingAddress, not both.',
      );
    }

    if (!hasAddressId && !hasInlineAddress) {
      throw new BadRequestException('A shipping address is required.');
    }

    /**
     * All checkout mutations happen in ONE transaction.
     *
     * Important:
     * - cart locking
     * - address creation
     * - stock deduction
     * - order creation
     * - order items
     * - payment row
     * - idempotency record
     *
     * Either all succeed or all roll back.
     */
    let order: OrderWithItems;

    try {
      order = await this.executeCheckout(userId, dto, normalizedAddressId, key);
    } catch (error) {
      /**
       * Two identical checkout requests can arrive at exactly the same time.
       *
       * The database's:
       *
       * @@unique([userId, idempotencyKey])
       *
       * is the final concurrency guard.
       *
       * If another request wins the race, this request gets P2002.
       * We then retrieve the already-created order and return it.
       */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.checkoutIdempotency.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: key,
            },
          },
          select: {
            orderId: true,
            expiresAt: true,
          },
        });

        if (existing && existing.expiresAt > new Date()) {
          const existingOrder = await this.prisma.order.findUnique({
            where: {
              id: existing.orderId,
            },
            include: orderInclude,
          });

          if (!existingOrder) {
            throw new ConflictException(
              'Checkout idempotency record references a missing order.',
            );
          }

          order = existingOrder;
        } else {
          throw new ConflictException(
            'Checkout request conflicted with another checkout. Please retry.',
          );
        }
      } else {
        throw error;
      }
    }

    /**
     * Paystack is deliberately initialized AFTER the database transaction.
     *
     * Never hold a PostgreSQL transaction open while waiting on an external
     * HTTP API.
     */
    let paymentInit: {
      authorizationUrl: string;
      accessCode?: string;
      reference: string;
      paymentId: string;
    } | null = null;

    try {
      paymentInit = await this.paymentsService.initializeForOrder(
        userId,
        order.id,
      );
    } catch (error) {
      /**
       * The order is already safely committed.
       *
       * Payment initialization can therefore be retried through the payment
       * endpoint without creating another order.
       */
      this.logger.warn(
        `Paystack initialization deferred for order ${order.id}`,
        error instanceof Error ? error.message : error,
      );
    }

    const response = this.toCheckoutResponse(order);

    if (paymentInit) {
      response.authorizationUrl = paymentInit.authorizationUrl;
      response.paymentId = paymentInit.paymentId;
      response.paystackAccessCode = paymentInit.accessCode ?? null;
      response.paymentReference = paymentInit.reference;
    }

    return response;
  }

  // ---------------------------------------------------------------------------
  // CUSTOMER ORDERS
  // ---------------------------------------------------------------------------

  async cancelMine(userId: string, orderId: string): Promise<OrderResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    /**
     * We intentionally only allow the customer to cancel an unpaid order.
     *
     * If payment already succeeded, cancellation needs the refund workflow.
     * We must never mark a real Paystack payment as "refunded" without actually
     * refunding it through Paystack.
     */
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
      },
      select: {
        id: true,
        status: true,
        payment: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.payment?.status === PaymentStatus.SUCCESS) {
      throw new BadRequestException(
        'This order has already been paid. A refund is required before cancellation.',
      );
    }

    await this.transitionOrderStatus({
      orderId,
      nextStatus: OrderStatus.CANCELLED,
      changedByUserId: userId,
    });

    return this.findOne(userId, orderId);
  }

  /**
   * System-automated cancellation for unpaid orders exceeding the checkout TTL.
   * Atomically transitions PENDING -> CANCELLED, releases reserved stock, updates
   * payment to FAILED, records audit history, and emits domain events.
   */
  async cancelExpiredPendingOrder(
    orderId: string,
    reason = 'Payment window expired (auto-cancelled by system)',
  ): Promise<boolean> {
    try {
      await this.transitionOrderStatus({
        orderId,
        nextStatus: OrderStatus.CANCELLED,
        note: reason,
      });
      this.logger.log(
        `Successfully auto-cancelled expired order ${orderId} and restored reserved stock`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to auto-cancel expired order ${orderId}: ${message}`,
      );
      return false;
    }
  }

  async findMine(userId: string, query: PaginationQueryDto) {
    await this.usersService.assertActiveAccount(userId);

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));

    const where: Prisma.OrderWhereInput = {
      userId,
    };

    /**
     * count() and findMany() run independently.
     *
     * This is appropriate for offset pagination.
     * For very large order volumes, move this endpoint to cursor pagination.
     */
    const [total, orders] = await Promise.all([
      this.prisma.order.count({
        where,
      }),

      this.prisma.order.findMany({
        where,
        include: orderListInclude,
        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        ...getPagination(page, limit),
      }),
    ]);

    return {
      data: orders.map((order) => this.toResponse(order)),
      meta: createPaginationMeta(total, page, limit),
    };
  }

  async findOne(userId: string, orderId: string): Promise<OrderResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    /**
     * Ownership is part of the SQL WHERE clause.
     *
     * This prevents accidentally loading another customer's order and then
     * checking ownership in application code.
     */
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
      },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.toResponse(order);
  }

  // ---------------------------------------------------------------------------
  // ADMIN ORDERS
  // ---------------------------------------------------------------------------

  async findAllAdmin(query: QueryOrderDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));

    const where: Prisma.OrderWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.search?.trim()) {
      const rawTerm = query.search.trim();
      const cleanTerm = rawTerm.replace(/^#/, '').trim();

      where.OR = [
        {
          orderNumber: {
            contains: cleanTerm,
            mode: 'insensitive',
          },
        },
        {
          user: {
            email: {
              contains: rawTerm,
              mode: 'insensitive',
            },
          },
        },
        {
          user: {
            firstName: {
              contains: rawTerm,
              mode: 'insensitive',
            },
          },
        },
        {
          user: {
            lastName: {
              contains: rawTerm,
              mode: 'insensitive',
            },
          },
        },
        {
          shippingAddress: {
            contains: rawTerm,
            mode: 'insensitive',
          },
        },
        {
          discountCode: {
            contains: rawTerm,
            mode: 'insensitive',
          },
        },
        {
          payment: {
            transactionReference: {
              contains: rawTerm,
              mode: 'insensitive',
            },
          },
        },
        {
          orderItems: {
            some: {
              product: {
                name: {
                  contains: rawTerm,
                  mode: 'insensitive',
                },
              },
            },
          },
        },
      ];
    }

    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate
          ? {
              gte: new Date(query.fromDate),
            }
          : {}),

        ...(query.toDate
          ? {
              /**
               * Query DTOs should preferably provide an exclusive upper bound.
               * This keeps date filtering predictable.
               */
              lt: new Date(query.toDate),
            }
          : {}),
      };
    }

    const [total, orders] = await Promise.all([
      this.prisma.order.count({
        where,
      }),

      this.prisma.order.findMany({
        where,
        include: adminOrderInclude,
        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        ...getPagination(page, limit),
      }),
    ]);

    return {
      data: orders.map((order) => this.toAdminResponse(order)),
      meta: createPaginationMeta(total, page, limit),
    };
  }

  async findOneAdmin(orderId: string): Promise<AdminOrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
      include: adminOrderInclude,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.toAdminResponse(order);
  }

  // ---------------------------------------------------------------------------
  // VENDOR ORDERS
  // ---------------------------------------------------------------------------

  async findAllForVendor(
    vendorId: string,
    params: {
      page?: number;
      limit?: number;
      status?: string;
      search?: string;
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<{
    data: VendorOrderResponseDto[];
    meta: ReturnType<typeof createPaginationMeta>;
  }> {
    const page = Math.max(1, Number(params.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit ?? 10) || 10));

    const where: Prisma.OrderWhereInput = {
      /**
       * Prisma converts this relation filter to an EXISTS-style relational
       * query. The OrderItem(vendorId, orderId) index supports this access.
       */
      orderItems: {
        some: {
          vendorId,
        },
      },
    };

    if (params.status) {
      where.status = params.status as OrderStatus;
    }

    if (params.search?.trim()) {
      const rawTerm = params.search.trim();
      const cleanTerm = rawTerm.replace(/^#/, '').trim();

      where.OR = [
        {
          orderNumber: {
            contains: cleanTerm,
            mode: 'insensitive',
          },
        },
        {
          user: {
            email: {
              contains: rawTerm,
              mode: 'insensitive',
            },
          },
        },
        {
          user: {
            firstName: {
              contains: rawTerm,
              mode: 'insensitive',
            },
          },
        },
        {
          user: {
            lastName: {
              contains: rawTerm,
              mode: 'insensitive',
            },
          },
        },
        {
          shippingAddress: {
            contains: rawTerm,
            mode: 'insensitive',
          },
        },
        {
          discountCode: {
            contains: rawTerm,
            mode: 'insensitive',
          },
        },
        {
          payment: {
            transactionReference: {
              contains: rawTerm,
              mode: 'insensitive',
            },
          },
        },
        {
          orderItems: {
            some: {
              product: {
                name: {
                  contains: rawTerm,
                  mode: 'insensitive',
                },
              },
            },
          },
        },
      ];
    }

    if (params.fromDate || params.toDate) {
      where.createdAt = {
        ...(params.fromDate
          ? {
              gte: new Date(params.fromDate),
            }
          : {}),

        ...(params.toDate
          ? {
              lt: new Date(params.toDate),
            }
          : {}),
      };
    }

    const [total, orders] = await Promise.all([
      this.prisma.order.count({
        where,
      }),

      this.prisma.order.findMany({
        where,
        include: vendorOrderListInclude,
        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        ...getPagination(page, limit),
      }),
    ]);

    return {
      data: orders.map((order) => this.toVendorResponse(order)),
      meta: createPaginationMeta(total, page, limit),
    };
  }

  async findOneForVendor(
    vendorId: string,
    orderId: string,
  ): Promise<VendorOrderResponseDto> {
    /**
     * Ownership is checked directly against OrderItem.
     *
     * The vendor must only see orders containing at least one of their
     * products.
     */
    const ownership = await this.prisma.orderItem.findFirst({
      where: {
        orderId,
        vendorId,
      },
      select: {
        orderId: true,
      },
    });

    if (!ownership) {
      throw new NotFoundException('Order not found');
    }

    const order = await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
      include: vendorOrderInclude,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.toVendorResponse(order);
  }

  async updateStatusAdmin(
    orderId: string,
    nextStatus: OrderStatus,
    adminId: string,
    note?: string,
  ): Promise<AdminOrderResponseDto> {
    const current = await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
      select: {
        status: true,
      },
    });

    if (!current) {
      throw new NotFoundException('Order not found');
    }

    if (current.status === nextStatus) {
      return this.findOneAdmin(orderId);
    }

    await this.transitionOrderStatus({
      orderId,
      nextStatus,
      changedByAdminId: adminId,
      note,
    });

    await this.auditLog.log({
      action: 'UPDATE_ORDER_STATUS',
      entity: 'Order',
      entityId: orderId,
      adminId,
      payload: {
        fromStatus: current.status,
        toStatus: nextStatus,
        note,
      },
    });

    return this.findOneAdmin(orderId);
  }

  async updateStatusForVendor(
    vendorId: string,
    orderId: string,
    nextStatus: OrderStatus,
    note?: string,
  ): Promise<VendorOrderResponseDto> {
    const ownership = await this.prisma.orderItem.findFirst({
      where: {
        orderId,
        vendorId,
      },
      select: {
        orderId: true,
      },
    });

    if (!ownership) {
      throw new NotFoundException('Order not found');
    }

    const allowedStatuses: OrderStatus[] = [
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ];

    if (!allowedStatuses.includes(nextStatus)) {
      throw new BadRequestException(
        `Vendors can only transition orders to: ${allowedStatuses.join(', ')}`,
      );
    }

    await this.transitionOrderStatus({
      orderId,
      nextStatus,
      changedByVendorId: vendorId,
      note,
    });

    return this.findOneForVendor(vendorId, orderId);
  }

  async updateShippingMine(
    userId: string,
    orderId: string,
    shippingAddress: string,
  ): Promise<OrderResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    const normalizedAddress = shippingAddress.trim();

    if (!normalizedAddress) {
      throw new BadRequestException('Shipping address cannot be empty.');
    }

    /**
     * Conditional UPDATE avoids:
     *
     * 1. SELECT
     * 2. application decision
     * 3. UPDATE
     *
     * The database performs the authorization/state check atomically.
     */
    const updated = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        userId,
        status: {
          notIn: [
            OrderStatus.CANCELLED,
            OrderStatus.DELIVERED,
            OrderStatus.REFUNDED,
          ],
        },
      },
      data: {
        shippingAddress: normalizedAddress,
      },
    });

    if (updated.count === 0) {
      const order = await this.prisma.order.findFirst({
        where: {
          id: orderId,
          userId,
        },
        select: {
          status: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      throw new BadRequestException(
        'Shipping address cannot be changed for this order.',
      );
    }

    return this.findOne(userId, orderId);
  }

  // ---------------------------------------------------------------------------
  // ORDER STATE MACHINE
  // ---------------------------------------------------------------------------

  private async transitionOrderStatus(params: {
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

    let orderUserId: string | undefined;
    let originalStatus: OrderStatus | undefined;

    try {
      await this.prisma.$transaction(
        async (tx) => {
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

          orderUserId = current.userId;
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
            await this.restoreOrderStock(
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

          /**
           * Vendor earnings are credited when payment succeeds.
           * They are therefore only settled after delivery.
           */
          if (nextStatus === OrderStatus.DELIVERED) {
            const vendorEarnings = this.calculateVendorEarnings(
              current.orderItems,
            );

            for (const [vendorId, amount] of vendorEarnings) {
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
        {
          timeout: 15_000,
        },
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

    /**
     * These are intentionally OUTSIDE the DB transaction.
     *
     * External side effects must never hold database locks.
     */
    if (nextStatus === OrderStatus.DELIVERED && orderUserId) {
      this.referralService
        .grantReferralRewards(orderId, orderUserId)
        .catch((error) => {
          this.logger.error(
            `Failed to grant referral rewards for ${orderId}`,
            error,
          );
        });
    }

    this.emitStatusChangeEvents(orderId, nextStatus, orderUserId).catch(
      (error) => {
        this.logger.error(
          `Failed to emit order status event for ${orderId}`,
          error,
        );
      },
    );

    return orderId;
  }

  // ---------------------------------------------------------------------------
  // CHECKOUT TRANSACTION
  // ---------------------------------------------------------------------------

  private async executeCheckout(
    userId: string,
    dto: CheckoutDto,
    addressId: string | undefined,
    idempotencyKey: string,
  ): Promise<OrderWithItems> {
    const order = await this.prisma.$transaction(
      async (tx) => {
        /**
         * IMPORTANT:
         *
         * We explicitly lock the user's active cart.
         *
         * findFirst() by itself does NOT lock the row.
         *
         * FOR UPDATE prevents two checkout requests from simultaneously
         * consuming the same cart.
         */
        const cartRows = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            SELECT "id"
            FROM "carts"
            WHERE "userId" = ${userId}
              AND "checkedOut" = false
            FOR UPDATE
          `,
        );

        /**
         * Re-check idempotency AFTER acquiring the cart lock.
         *
         * This is important for two identical requests arriving concurrently.
         */
        const existingIdempotency = await tx.checkoutIdempotency.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey,
            },
          },
          select: {
            orderId: true,
            expiresAt: true,
          },
        });

        if (existingIdempotency && existingIdempotency.expiresAt > new Date()) {
          const existingOrder = await tx.order.findUnique({
            where: {
              id: existingIdempotency.orderId,
            },
            include: orderInclude,
          });

          if (!existingOrder) {
            throw new ConflictException(
              'Idempotency record references a missing order.',
            );
          }

          return existingOrder;
        }

        if (!cartRows.length) {
          throw new BadRequestException(
            'Your cart is empty or has already been checked out.',
          );
        }

        /**
         * Fetch all active carts locked for this user.
         *
         * If duplicate active carts exist (from multi-tab sessions or concurrent requests),
         * prioritize the cart that contains items over empty orphan carts.
         */
        const candidateCarts = await tx.cart.findMany({
          where: {
            id: { in: cartRows.map((r) => r.id) },
          },
          include: {
            cartItems: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    price: true,
                    isActive: true,
                    isDeleted: true,
                    vendorId: true,
                    images: {
                      select: {
                        url: true,
                      },
                      orderBy: {
                        position: 'asc',
                      },
                    },
                  },
                },

                variant: {
                  select: {
                    id: true,
                    options: true,
                    stock: true,
                    isActive: true,
                    isDeleted: true,
                  },
                },
              },
            },
          },
          orderBy: {
            updatedAt: 'desc',
          },
        });

        const cart =
          candidateCarts.find((c) => c.cartItems.length > 0) ??
          candidateCarts[0];

        if (!cart || cart.checkedOut) {
          throw new BadRequestException(
            'Your cart has already been checked out.',
          );
        }

        if (!cart.cartItems.length) {
          throw new BadRequestException('Your cart is empty.');
        }

        // Clean up any remaining empty duplicate carts for this user
        const duplicateEmptyCartIds = candidateCarts
          .filter((c) => c.id !== cart.id && c.cartItems.length === 0)
          .map((c) => c.id);

        if (duplicateEmptyCartIds.length > 0) {
          await tx.cart.deleteMany({
            where: {
              id: { in: duplicateEmptyCartIds },
            },
          });
        }

        /**
         * Validate all cart items before changing inventory.
         */
        for (const item of cart.cartItems) {
          if (item.product.isDeleted || !item.product.isActive) {
            throw new BadRequestException(
              `Product "${item.product.name}" is no longer available.`,
            );
          }

          if (!item.product.vendorId) {
            throw new BadRequestException(
              `Product "${item.product.name}" has no vendor assignment.`,
            );
          }

          if (
            item.variantId &&
            (!item.variant || item.variant.isDeleted || !item.variant.isActive)
          ) {
            throw new BadRequestException(
              `Selected variant for "${item.product.name}" is no longer available.`,
            );
          }

          if (item.quantity <= 0) {
            throw new BadRequestException(
              `Invalid quantity for "${item.product.name}".`,
            );
          }
        }

        /**
         * Resolve the shipping address INSIDE the transaction.
         *
         * If inlineAddress is created and something later fails,
         * the address creation rolls back with the checkout.
         */
        const shipping = await this.resolveShippingAddress(
          tx,
          userId,
          dto,
          addressId,
        );

        /**
         * Revalidate prices using Decimal.
         *
         * We never use JS floating-point arithmetic for the authoritative
         * database values.
         */
        for (const item of cart.cartItems) {
          const livePrice = item.product.price;

          if (this.revalidatePrices && !livePrice.equals(item.unitPrice)) {
            await tx.cartItem.update({
              where: {
                id: item.id,
              },
              data: {
                unitPrice: livePrice,
                totalPrice: livePrice.mul(item.quantity),
              },
            });

            item.unitPrice = livePrice;
            item.totalPrice = livePrice.mul(item.quantity);

            this.logger.warn(`Cart price synchronized for cartItem=${item.id}`);
          }
        }

        /**
         * Calculate subtotal using Decimal.
         */
        let totalAmount = new Prisma.Decimal(0);

        for (const item of cart.cartItems) {
          totalAmount = totalAmount.add(item.unitPrice.mul(item.quantity));
        }

        totalAmount = totalAmount.toDecimalPlaces(2);

        // ---------------------------------------------------------------
        // DISCOUNT
        // ---------------------------------------------------------------

        let discountAmount = new Prisma.Decimal(0);
        let discountCode: string | null = null;

        let discountRecord: Awaited<
          ReturnType<typeof this.discountCodeService.validate>
        > | null = null;

        if (dto.discountCode?.trim()) {
          discountRecord = await this.discountCodeService.validate(
            dto.discountCode.trim(),
            userId,
            totalAmount,
          );

          discountCode = discountRecord.code;

          /**
           * Product-scoped vendor discounts must match at least one
           * product in this cart.
           */
          if (
            discountRecord.scope === 'VENDOR' &&
            !discountRecord.platformwide &&
            discountRecord.applicableProductIds.length > 0
          ) {
            const applicable = cart.cartItems.some((item) =>
              discountRecord!.applicableProductIds.includes(item.productId),
            );

            if (!applicable) {
              throw new BadRequestException(
                'This discount code does not apply to any products in your cart.',
              );
            }
          }

          discountAmount = this.discountCodeService.calculateDiscount(
            discountRecord,
            totalAmount,
          );

          discountAmount = discountAmount.toDecimalPlaces(2);
        }

        const finalAmount = Prisma.Decimal.max(
          totalAmount.sub(discountAmount),
          new Prisma.Decimal(0),
        ).toDecimalPlaces(2);

        // ---------------------------------------------------------------
        // INVENTORY
        // ---------------------------------------------------------------

        const stockHistoryRows: Prisma.StockHistoryCreateManyInput[] = [];

        /**
         * Deduct stock one inventory row at a time in deterministic order.
         *
         * Deterministic row lock ordering eliminates PostgreSQL deadlocks (SQLSTATE 40P01)
         * when multiple users concurrently check out overlapping sets of items.
         */
        const itemsToDeduct = [...cart.cartItems].sort((a, b) => {
          const aKey = a.variantId ?? a.productId;
          const bKey = b.variantId ?? b.productId;
          return aKey.localeCompare(bKey);
        });

        const shortfalls: StockShortfallItem[] = [];

        for (const item of itemsToDeduct) {
          const variantLabel = item.variant
            ? this.variantLabel(item.variant.options)
            : null;

          const toShortfall = (available: number): StockShortfallItem => ({
            productId: item.productId,
            variantId: item.variantId ?? null,
            name: item.product.name,
            variantLabel,
            requested: item.quantity,
            available,
          });

          /**
           * Once any line has failed, this transaction is guaranteed to roll
           * back. Stop acquiring row locks (which would only increase
           * contention for other shoppers) and fall back to non-blocking MVCC
           * reads so the customer gets every unavailable line in one response.
           */
          if (shortfalls.length > 0) {
            const available = await this.readLiveStock(
              tx,
              item.productId,
              item.variantId,
            );

            if (available < item.quantity) {
              shortfalls.push(toShortfall(available));
            }

            continue;
          }

          if (item.variantId) {
            const rows = await tx.$queryRaw<
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
                  "stock" = "stock" - ${item.quantity},
                  "updatedAt" = NOW()
                WHERE
                  "id" = ${item.variantId}
                  AND "isActive" = true
                  AND "isDeleted" = false
                  AND "stock" >= ${item.quantity}
                RETURNING
                  "id",
                  "productId",
                  ("stock" + ${item.quantity}) AS "oldStock",
                  "stock" AS "newStock"
              `,
            );

            if (rows.length !== 1) {
              shortfalls.push(
                toShortfall(
                  await this.readLiveStock(tx, item.productId, item.variantId),
                ),
              );
              continue;
            }

            stockHistoryRows.push({
              productId: item.productId,
              variantId: item.variantId,
              adjustment: -item.quantity,
              oldStockQuantity: rows[0].oldStock,
              newStockQuantity: rows[0].newStock,
              description: 'Stock deducted during checkout',
            });
          } else {
            const rows = await tx.$queryRaw<
              Array<{
                id: string;
                oldStock: number;
                newStock: number;
              }>
            >(
              Prisma.sql`
                UPDATE "products"
                SET
                  "stock" = "stock" - ${item.quantity},
                  "updatedAt" = NOW()
                WHERE
                  "id" = ${item.productId}
                  AND "isActive" = true
                  AND "isDeleted" = false
                  AND "stock" >= ${item.quantity}
                RETURNING
                  "id",
                  ("stock" + ${item.quantity}) AS "oldStock",
                  "stock" AS "newStock"
              `,
            );

            if (rows.length !== 1) {
              shortfalls.push(
                toShortfall(await this.readLiveStock(tx, item.productId, null)),
              );
              continue;
            }

            stockHistoryRows.push({
              productId: item.productId,
              adjustment: -item.quantity,
              oldStockQuantity: rows[0].oldStock,
              newStockQuantity: rows[0].newStock,
              description: 'Stock deducted during checkout',
            });
          }
        }

        if (shortfalls.length > 0) {
          this.logger.warn(
            {
              event: 'checkout.insufficient_stock',
              userId,
              cartId: cart.id,
              items: shortfalls.map((s) => ({
                productId: s.productId,
                variantId: s.variantId,
                requested: s.requested,
                available: s.available,
              })),
            },
            'Checkout rejected: insufficient stock',
          );

          // Rolls back every stock decrement already applied in this tx.
          throw new InsufficientStockException(shortfalls);
        }

        if (stockHistoryRows.length) {
          await tx.stockHistory.createMany({
            data: stockHistoryRows,
          });
        }

        // ---------------------------------------------------------------
        // ORDER
        // ---------------------------------------------------------------

        const orderNumber = this.generateUniqueOrderNumber();

        const order = await tx.order.create({
          data: {
            orderNumber,
            userId,
            cartId: cart.id,
            status: OrderStatus.PENDING,

            totalAmount,
            discountAmount,
            finalAmount,

            /**
             * Your current checkout implementation does not actually
             * calculate a referral discount.
             *
             * Therefore we leave this at its DB default of zero rather
             * than pretending a referral discount was applied.
             */
            discountCode,

            shippingAddress: shipping.formattedAddress,

            shippingAddressId: shipping.addressId,
          },
        });

        // ---------------------------------------------------------------
        // ORDER ITEMS
        // ---------------------------------------------------------------

        await tx.orderItem.createMany({
          data: cart.cartItems.map((item) => ({
            orderId: order.id,
            productId: item.productId,
            variantId: item.variantId?.trim() || null,
            vendorId: item.product.vendorId,

            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.unitPrice.mul(item.quantity).toDecimalPlaces(2),

            /**
             * Snapshots are critical.
             *
             * Product names/prices/images can change after purchase.
             * The order must continue displaying what the customer bought.
             */
            productSnapshot: {
              name: item.product.name,
              sku: item.product.sku,
              images: item.product.images.map((image) => image.url),
            },

            variantSnapshot: item.variant
              ? (item.variant.options as Prisma.InputJsonValue)
              : Prisma.DbNull,
          })),
        });

        // ---------------------------------------------------------------
        // ORDER STATUS HISTORY
        // ---------------------------------------------------------------

        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: null,
            toStatus: OrderStatus.PENDING,
            note: 'Order placed',
          },
        });

        // ---------------------------------------------------------------
        // PAYMENT
        // ---------------------------------------------------------------

        /**
         * One payment row belongs to exactly one order because:
         *
         * Payment.orderId @unique
         */
        await tx.payment.create({
          data: {
            amount: finalAmount,
            status: PaymentStatus.PENDING,
            currency: this.defaultCurrency,
            userId,
            orderId: order.id,
          },
        });

        // ---------------------------------------------------------------
        // DISCOUNT USAGE
        // ---------------------------------------------------------------

        if (discountRecord) {
          /**
           * Discount usage is recorded inside the same checkout transaction.
           *
           * This is critical:
           *
           * - the order cannot commit without its discount usage
           * - usage counters cannot commit without the order
           * - a failed checkout cannot consume the discount
           * - concurrent redemptions are serialized by recordUsage()
           */
          await this.discountCodeService.recordUsage(
            discountRecord.id,
            order.id,
            userId,
            discountAmount,
            tx,
          );
        }

        // ---------------------------------------------------------------
        // IDEMPOTENCY
        // ---------------------------------------------------------------

        const expiresAt = new Date(
          Date.now() + CHECKOUT_IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000,
        );

        await tx.checkoutIdempotency.create({
          data: {
            userId,
            idempotencyKey,
            orderId: order.id,
            expiresAt,
          },
        });

        /**
         * Consume the cart immediately.
         *
         * This is intentional.
         *
         * Payment failure should not create another order from the same cart.
         * The customer can simply retry payment against this existing order.
         */
        await tx.cart.update({
          where: {
            id: cart.id,
          },
          data: {
            checkedOut: true,
          },
        });

        await tx.cartItem.deleteMany({
          where: {
            cartId: cart.id,
          },
        });

        /**
         * Fetch only after all writes succeed.
         *
         * This gives checkout the exact response representation used by
         * normal order retrieval.
         */
        const fullOrder = await tx.order.findUnique({
          where: {
            id: order.id,
          },
          include: orderInclude,
        });

        if (!fullOrder) {
          throw new ConflictException(
            'Order was created but could not be retrieved.',
          );
        }

        return fullOrder;
      },
      {
        timeout: 15_000,
      },
    );

    await this.invalidateCartCache(userId);

    return order;
  }

  // ---------------------------------------------------------------------------
  // SHIPPING ADDRESS
  // ---------------------------------------------------------------------------

  private async resolveShippingAddress(
    tx: TransactionClient,
    userId: string,
    dto: CheckoutDto,
    addressId?: string,
  ): Promise<{
    formattedAddress: string;
    addressId: string;
  }> {
    if (addressId) {
      const savedAddress = await tx.shippingAddress.findFirst({
        where: {
          id: addressId,
          userId,
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          street: true,
          city: true,
          state: true,
          country: true,
        },
      });

      if (!savedAddress) {
        throw new NotFoundException('Shipping address not found.');
      }

      return {
        addressId: savedAddress.id,
        formattedAddress: this.formatShippingAddress(savedAddress),
      };
    }

    if (!dto.shippingAddress) {
      throw new BadRequestException('Shipping address is required.');
    }

    /**
     * Creating the address inside the checkout transaction means an
     * unsuccessful checkout cannot leave an orphan address.
     */
    const created = await tx.shippingAddress.create({
      data: {
        userId,
        fullName: dto.shippingAddress.fullName,
        phone: dto.shippingAddress.phone,
        street: dto.shippingAddress.street,
        city: dto.shippingAddress.city,
        state: dto.shippingAddress.state,
        country: dto.shippingAddress.country ?? 'Nigeria',
        isDefault: false,
      },
      select: {
        id: true,
        fullName: true,
        phone: true,
        street: true,
        city: true,
        state: true,
        country: true,
      },
    });

    return {
      addressId: created.id,
      formattedAddress: this.formatShippingAddress(created),
    };
  }

  private formatShippingAddress(address: {
    fullName: string;
    phone: string;
    street: string;
    city: string;
    state: string;
    country: string;
  }): string {
    const parts = [
      address.fullName,
      address.street,
      address.city,
      address.state,
      address.country,
    ].filter(Boolean);

    return `${parts.join(', ')} (Tel: ${address.phone})`;
  }

  // ---------------------------------------------------------------------------
  // STOCK
  // ---------------------------------------------------------------------------

  private async restoreOrderStock(
    tx: TransactionClient,
    orderItems: Array<{
      productId: string;
      variantId: string | null;
      quantity: number;
    }>,
    description: string,
  ): Promise<void> {
    const historyRows: Prisma.StockHistoryCreateManyInput[] = [];

    /**
     * Process in deterministic order.
     *
     * Deterministic lock ordering reduces deadlock probability when multiple
     * transactions touch several inventory rows.
     */
    const items = [...orderItems].sort((a, b) => {
      const aKey = a.variantId ?? a.productId;
      const bKey = b.variantId ?? b.productId;

      return aKey.localeCompare(bKey);
    });

    for (const item of items) {
      if (item.variantId) {
        const rows = await tx.$queryRaw<
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

        if (rows.length !== 1) {
          throw new ConflictException(
            `Variant ${item.variantId} could not be restored.`,
          );
        }

        historyRows.push({
          productId: rows[0].productId,
          variantId: rows[0].id,
          adjustment: item.quantity,
          oldStockQuantity: rows[0].oldStock,
          newStockQuantity: rows[0].newStock,
          description,
        });
      } else {
        const rows = await tx.$queryRaw<
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

        if (rows.length !== 1) {
          throw new ConflictException(
            `Product ${item.productId} could not be restored.`,
          );
        }

        historyRows.push({
          productId: rows[0].id,
          adjustment: item.quantity,
          oldStockQuantity: rows[0].oldStock,
          newStockQuantity: rows[0].newStock,
          description,
        });
      }
    }

    if (historyRows.length) {
      await tx.stockHistory.createMany({
        data: historyRows,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // VENDOR MONEY
  // ---------------------------------------------------------------------------

  private calculateVendorEarnings(
    items: Array<{
      vendorId: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
    }>,
  ): Map<string, Prisma.Decimal> {
    const earnings = new Map<string, Prisma.Decimal>();

    for (const item of items) {
      /**
       * Decimal arithmetic avoids floating-point money errors.
       *
       * Example:
       * 10000 * 0.85
       *
       * stays as a Decimal rather than becoming a JS floating-point number.
       */
      const earning = item.unitPrice
        .mul(item.quantity)
        .mul(VENDOR_COMMISSION_RATE)
        .toDecimalPlaces(2);

      const existing = earnings.get(item.vendorId) ?? new Prisma.Decimal(0);

      earnings.set(item.vendorId, existing.add(earning).toDecimalPlaces(2));
    }

    return earnings;
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private generateUniqueOrderNumber(): string {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    return `ORD-${datePart}-${this.generateOrderId()}`;
  }

  /**
   * Reads currently sellable stock for a line without taking a row lock.
   *
   * Used only to build an accurate INSUFFICIENT_STOCK response after the
   * authoritative conditional UPDATE has already failed. Inactive/deleted
   * inventory is reported as 0 because it cannot be purchased.
   */
  private async readLiveStock(
    tx: TransactionClient,
    productId: string,
    variantId: string | null,
  ): Promise<number> {
    const row = variantId
      ? await tx.productVariant.findUnique({
          where: { id: variantId },
          select: { stock: true, isActive: true, isDeleted: true },
        })
      : await tx.product.findUnique({
          where: { id: productId },
          select: { stock: true, isActive: true, isDeleted: true },
        });

    if (!row || !row.isActive || row.isDeleted) {
      return 0;
    }

    return Math.max(0, row.stock);
  }

  private variantLabel(options: Prisma.JsonValue): string | null {
    if (Array.isArray(options)) {
      return options
        .map((option) => {
          if (
            isRecord(option) &&
            typeof option.name === 'string' &&
            typeof option.value === 'string'
          ) {
            return `${option.name}: ${option.value}`;
          }

          return jsonValueLabel(option);
        })
        .join(', ');
    }

    if (typeof options === 'object' && options !== null) {
      return Object.entries(options as Record<string, unknown>)
        .map(([name, value]) => `${name}: ${jsonValueLabel(value)}`)
        .join(', ');
    }

    return null;
  }

  private normalizeVariantSnapshot(snapshot: unknown): {
    options: {
      name: string;
      value: string;
    }[];
  } | null {
    if (!snapshot) {
      return null;
    }

    if (Array.isArray(snapshot)) {
      return {
        options: snapshot.filter(
          (
            option,
          ): option is {
            name: string;
            value: string;
          } =>
            isRecord(option) &&
            typeof option.name === 'string' &&
            typeof option.value === 'string',
        ),
      };
    }

    if (typeof snapshot === 'object' && snapshot !== null) {
      return {
        options: Object.entries(snapshot as Record<string, unknown>).map(
          ([name, value]) => ({
            name,
            value: String(value),
          }),
        ),
      };
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // RESPONSE MAPPERS
  // ---------------------------------------------------------------------------

  private toResponse(
    order: OrderWithItems | OrderWithItemsList,
  ): OrderResponseDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,

      totalAmount: Number(order.totalAmount),
      discountAmount: Number(order.discountAmount),
      referralDiscountAmount: Number(order.referralDiscountAmount),
      finalAmount: Number(order.finalAmount),

      discountCode: order.discountCode ?? null,

      referralCode: order.referralCode ?? null,

      shippingAddress: order.shippingAddress,

      shippingAddressId: order.shippingAddressId ?? null,

      createdAt: order.createdAt,

      paymentExpiresAt:
        order.status === OrderStatus.PENDING
          ? new Date(
              new Date(order.createdAt).getTime() +
                UNPAID_ORDER_EXPIRATION.PENDING_TTL_MINUTES * 60 * 1000,
            )
          : null,

      items: order.orderItems.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,

        quantity: item.quantity,

        unitPrice: Number(item.unitPrice),

        totalPrice: Number(item.totalPrice),

        productSnapshot: item.productSnapshot as {
          name: string;
          sku: string;
          images: string[];
        },

        variantSnapshot: this.normalizeVariantSnapshot(item.variantSnapshot),
      })),
    };
  }

  private toCheckoutResponse(order: OrderWithItems): CheckoutResponseDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,

      totalAmount: Number(order.totalAmount),
      discountAmount: Number(order.discountAmount),
      referralDiscountAmount: Number(order.referralDiscountAmount),
      finalAmount: Number(order.finalAmount),

      discountCode: order.discountCode ?? null,

      referralCode: order.referralCode ?? null,

      items: order.orderItems.map((item) => {
        const productSnapshot = item.productSnapshot as {
          name?: string;
          sku?: string;
          images?: string[];
        } | null;

        const variantSnapshot = this.normalizeVariantSnapshot(
          item.variantSnapshot,
        );

        return {
          productName: productSnapshot?.name ?? item.product.name,

          variantName: variantSnapshot
            ? variantSnapshot.options.map((option) => option.value).join(', ')
            : undefined,

          quantity: item.quantity,

          unitPrice: Number(item.unitPrice),
        };
      }),

      shippingAddress: order.shippingAddress ?? null,

      createdAt: order.createdAt,

      paymentExpiresAt:
        order.status === OrderStatus.PENDING
          ? new Date(
              new Date(order.createdAt).getTime() +
                UNPAID_ORDER_EXPIRATION.PENDING_TTL_MINUTES * 60 * 1000,
            )
          : null,
    };
  }

  private toVendorResponse(
    order: VendorOrderWithRelations | VendorOrderWithRelationsList,
  ): VendorOrderResponseDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,

      totalAmount: Number(order.totalAmount),
      discountAmount: Number(order.discountAmount),
      referralDiscountAmount: Number(order.referralDiscountAmount),
      finalAmount: Number(order.finalAmount),

      discountCode: order.discountCode ?? null,

      referralCode: order.referralCode ?? null,

      shippingAddress: order.shippingAddress,

      stockRestored: order.stockRestored,

      createdAt: order.createdAt,
      updatedAt: order.updatedAt,

      customer: {
        id: order.user.id,
        email: order.user.email,
        firstName: order.user.firstName,
        lastName: order.user.lastName,
      },

      items: order.orderItems.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),

        productSnapshot: item.productSnapshot as {
          name: string;
          sku: string;
          images: string[];
        },

        variantSnapshot: this.normalizeVariantSnapshot(item.variantSnapshot),
      })),

      statusHistory:
        'statusHistory' in order
          ? order.statusHistory.map((history) => {
              const actor =
                history.changedByUser ??
                history.changedByVendor ??
                history.changedByAdmin;

              return {
                id: history.id,
                fromStatus: history.fromStatus ?? null,
                toStatus: history.toStatus,
                note: history.note ?? null,
                createdAt: history.createdAt,
                changedBy: actor
                  ? {
                      id: actor.id,
                      email: actor.email,
                      firstName: actor.firstName,
                      lastName: actor.lastName,
                    }
                  : null,
              };
            })
          : [],
    };
  }

  private toAdminResponse(
    order: AdminOrderWithRelations,
  ): AdminOrderResponseDto {
    const itemsTotal =
      order.orderItems?.reduce(
        (sum, item) => sum + Number(item.totalPrice),
        0,
      ) ?? 0;
    const effectiveBase =
      itemsTotal > 0
        ? itemsTotal
        : Number(order.finalAmount || order.totalAmount || 0);
    const vendorRevenue =
      Math.round(effectiveBase * VENDOR_COMMISSION_RATE * 100) / 100;
    const platformFee = Math.round((effectiveBase - vendorRevenue) * 100) / 100;

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,

      paymentStatus: order.payment?.status ?? PaymentStatus.PENDING,

      totalAmount: Number(order.totalAmount),

      discountAmount: Number(order.discountAmount),

      referralDiscountAmount: Number(order.referralDiscountAmount),

      finalAmount: Number(order.finalAmount),

      discountCode: order.discountCode ?? null,

      referralCode: order.referralCode ?? null,

      platformFee,
      vendorRevenue,

      shippingAddress: order.shippingAddress,

      stockRestored: order.stockRestored,

      createdAt: order.createdAt,
      updatedAt: order.updatedAt,

      customer: {
        id: order.user.id,
        email: order.user.email,
        firstName: order.user.firstName,
        lastName: order.user.lastName,
      },

      payment: order.payment
        ? {
            id: order.payment.id,
            status: order.payment.status,
            amount: Number(order.payment.amount),
            currency: order.payment.currency,
            transactionId: order.payment.transactionId,
          }
        : null,

      items: order.orderItems.map((item) => ({
        productId: item.productId,

        productSku:
          (
            item.productSnapshot as {
              sku?: string;
            } | null
          )?.sku ?? item.product.sku,

        quantity: item.quantity,

        unitPrice: Number(item.unitPrice),

        totalPrice: Number(item.totalPrice),

        productSnapshot: item.productSnapshot as {
          name: string;
          sku: string;
          images: string[];
        },

        variantSnapshot: this.normalizeVariantSnapshot(item.variantSnapshot),
      })),

      statusHistory: order.statusHistory.map((history) => {
        const actor =
          history.changedByUser ??
          history.changedByVendor ??
          history.changedByAdmin;

        return {
          id: history.id,
          fromStatus: history.fromStatus,
          toStatus: history.toStatus,
          note: history.note,
          createdAt: history.createdAt,
          changedBy: actor
            ? {
                id: actor.id,
                email: actor.email,
                firstName: actor.firstName,
                lastName: actor.lastName,
              }
            : null,
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // DOMAIN EVENTS
  // ---------------------------------------------------------------------------

  private async emitStatusChangeEvents(
    orderId: string,
    nextStatus: OrderStatus,
    orderUserId: string | undefined,
  ): Promise<void> {
    if (!orderUserId) {
      return;
    }

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

          this.eventEmitter.emit(DomainEvents.ORDER_SHIPPED, payload);

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

          this.eventEmitter.emit(DomainEvents.ORDER_DELIVERED, payload);

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

          this.eventEmitter.emit(DomainEvents.ORDER_CANCELLED, payload);

          break;
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to emit status event for order ${orderId}`,
        error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // ORDER CONFIRMATION EMAIL
  // ---------------------------------------------------------------------------

  /**
   * Dispatches the official order confirmation email with generated PDF invoice.
   *
   * Crucial: This must only be invoked when payment has been successfully confirmed
   * (e.g., transition to PROCESSING / payment SUCCESS), never during initial unpaid checkout.
   */
  async sendOrderConfirmationEmail(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
            },
          },
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
      });

      if (!order || !order.user) {
        return;
      }

      const items = order.orderItems.map((item) => ({
        productName: item.product.name,
        quantity: item.quantity,
        price: Number(item.unitPrice),
      }));

      await this.emailService.sendOrderConfirmation(order.user.email, {
        orderNumber: order.orderNumber,
        customerName:
          `${order.user.firstName ?? ''} ${order.user.lastName ?? ''}`.trim() ||
          'Valued Customer',
        customerEmail: order.user.email,
        shippingAddress: order.shippingAddress ?? '',
        totalAmount: Number(order.totalAmount),
        discountAmount: Number(order.discountAmount),
        discountCode: order.discountCode,
        finalAmount: Number(order.finalAmount),
        currency: this.defaultCurrency,
        createdAt: order.createdAt,
        items,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send order confirmation email for order ${orderId}`,
        error,
      );
    }
  }
}
