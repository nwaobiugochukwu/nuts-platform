import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { UsersService } from '@api/modules/users/services/users.service';

import { AdminOrderResponseDto } from '../dto/admin-order-response.dto';
import { OrderResponseDto } from '../dto/order-response.dto';
import { QueryOrderDto } from '../dto/query-order.dto';
import { VendorOrderResponseDto } from '../dto/vendor-order-response.dto';

import { PaginationQueryDto } from '@api/common/dto/pagination-query.dto';
import { createPaginationMeta } from '@api/common/utils/pagination-meta.util';
import { getPagination } from '@api/common/utils/pagination.util';

import {
  MULTI_VENDOR_STATUS_MESSAGE,
  vendorMayChangeOrderStatus,
} from '../constants/order-status.constants';

import {} from '@api/modules/discounts/utils/discount-funding.util';

import type {} from '@api/infrastructure/messaging/events/event-payloads.types';
import { OrderStatusService } from './order-status.service';
import { auditDetails } from '@api/modules/audit/utils/audit-details.util';
import {
  adminOrderInclude,
  orderInclude,
  orderListInclude,
  vendorOrderInclude,
  vendorOrderListInclude,
} from '../utils/order-includes.util';
import {
  toAdminResponse,
  toResponse,
  toVendorResponse,
} from '../utils/order-response.mapper';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly orderStatus: OrderStatusService,
  ) {}

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

    await this.orderStatus.transition({
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
      await this.orderStatus.transition({
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
      data: orders.map((order) => toResponse(order)),
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

    return toResponse(order);
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
      data: orders.map((order) => toAdminResponse(order)),
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

    return toAdminResponse(order);
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
      data: orders.map((order) => toVendorResponse(order)),
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

    return toVendorResponse(order);
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

    await this.orderStatus.transition({
      orderId,
      nextStatus,
      changedByAdminId: adminId,
      note,
    });

    auditDetails({
      entityId: orderId,
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

    const vendorsOnOrder = await this.prisma.orderItem.findMany({
      where: { orderId },
      distinct: ['vendorId'],
      select: { vendorId: true },
    });
    if (
      !vendorMayChangeOrderStatus(vendorsOnOrder.map((row) => row.vendorId))
    ) {
      throw new ForbiddenException(MULTI_VENDOR_STATUS_MESSAGE);
    }

    await this.orderStatus.transition({
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
  // CHECKOUT TRANSACTION
  // ---------------------------------------------------------------------------
}
