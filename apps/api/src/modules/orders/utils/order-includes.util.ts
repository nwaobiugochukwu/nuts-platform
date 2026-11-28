import type { Prisma } from '@prisma/client';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const jsonValueLabel = (value: unknown): string => {
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
export const orderInclude = {
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

  // Snapshot of what each voucher took off this order (breakdown on the
  // order page).
  discountCodeUsages: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      discountAmount: true,
      discountCode: {
        select: {
          code: true,
          description: true,
          scope: true,
          type: true,
          value: true,
          autoApply: true,
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

/**
 * Lighter relation graph for order lists.
 *
 * Payment information is deliberately omitted because the list endpoint
 * doesn't need Paystack references or payment links.
 */
export const orderListInclude = {
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
export const statusHistoryInclude = {
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

export const vendorOrderInclude = {
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

export const vendorOrderListInclude = {
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

export const adminOrderInclude = {
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

export type OrderWithItems = Prisma.OrderGetPayload<{
  include: typeof orderInclude;
}>;

export type OrderWithItemsList = Prisma.OrderGetPayload<{
  include: typeof orderListInclude;
}>;

export type VendorOrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof vendorOrderInclude;
}>;

export type VendorOrderWithRelationsList = Prisma.OrderGetPayload<{
  include: typeof vendorOrderListInclude;
}>;

export type AdminOrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof adminOrderInclude;
}>;
