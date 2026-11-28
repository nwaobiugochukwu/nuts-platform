import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { CHECKOUT_IDEMPOTENCY_TTL_HOURS } from '@api/common/constants/checkout.constants';
import {
  InsufficientStockException,
  type StockShortfallItem,
} from '@api/common/errors/insufficient-stock.exception';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';
import { CART_CACHE_PREFIX } from '@api/modules/cart/services/cart.service';
import { DiscountCodeService } from '@api/modules/discounts/services/discount-code.service';
import { PaymentsService } from '@api/modules/payments/services/payments.service';
import { UsersService } from '@api/modules/users/services/users.service';
import { CheckoutResponseDto } from '../dto/checkout-response.dto';
import { CheckoutDto } from '../dto/checkout.dto';
import {
  orderInclude,
  type OrderWithItems,
} from '../utils/order-includes.util';
import {
  toCheckoutResponse,
  variantLabel,
} from '../utils/order-response.mapper';

type TransactionClient = Prisma.TransactionClient;

/** What checkout reads of the cart: its items, with the product and variant each was added as. */
const checkoutCartInclude = {
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
          categoryId: true,
          category: { select: { parentId: true } },
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
} satisfies Prisma.CartInclude;

type CheckoutCart = Prisma.CartGetPayload<{
  include: typeof checkoutCartInclude;
}>;

interface AppliedVoucher {
  id: string;
  code: string;
  amount: Prisma.Decimal;
}

interface CheckoutDiscounts {
  discountAmount: Prisma.Decimal;
  discountCode: string | null;
  appliedVouchers: AppliedVoucher[];
  finalAmount: Prisma.Decimal;
}

/**
 * Checkout: turns the shopper's cart into an order, all in one transaction (cart lock, address,
 * prices, discounts, stock, order, payment row, idempotency record), and only then asks Paystack
 * for a payment link, so a slow provider can never hold a database transaction open.
 */
@Injectable()
export class OrderCheckoutService {
  private readonly logger = new Logger(OrderCheckoutService.name);

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
    private readonly transactions: TransactionRunnerService,
    private readonly usersService: UsersService,
    private readonly discountCodeService: DiscountCodeService,
    private readonly paymentsService: PaymentsService,
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

  /** Places the order for the shopper's cart, replaying the same order for a repeated idempotency key. */
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

    const response = toCheckoutResponse(order);

    if (paymentInit) {
      response.authorizationUrl = paymentInit.authorizationUrl;
      response.paymentId = paymentInit.paymentId;
      response.paystackAccessCode = paymentInit.accessCode ?? null;
      response.paymentReference = paymentInit.reference;
    }

    return response;
  }

  /** The checkout transaction: each step below does one thing and hands its result to the next. */
  private async executeCheckout(
    userId: string,
    dto: CheckoutDto,
    addressId: string | undefined,
    idempotencyKey: string,
  ): Promise<OrderWithItems> {
    return this.transactions.run(
      async (ctx) => {
        const tx = ctx.tx;

        // Runs after commit, also when this is a replay of an order placed earlier.
        ctx.afterCommit(async () => {
          await this.invalidateCartCache(userId);
          // The user now has a prior order: first-order promos must stop showing.
          await this.discountCodeService
            .invalidateFirstOrderCache(userId)
            .catch(() => undefined);
        });

        const loaded = await this.loadCart(tx, userId, idempotencyKey);
        if ('existing' in loaded) return loaded.existing;
        const { cart } = loaded;

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

        const totalAmount = await this.priceCart(tx, cart);
        const discounts = await this.applyDiscounts(
          userId,
          dto,
          cart,
          totalAmount,
        );
        await this.deductStock(tx, userId, cart);

        return this.createOrder(tx, {
          userId,
          idempotencyKey,
          cart,
          shipping,
          totalAmount,
          ...discounts,
        });
      },
      { name: 'order.checkout' },
    );
  }

  /**
   * Locks the shopper's active cart (so two checkouts cannot consume it together), replays an
   * order already placed under this idempotency key, and otherwise returns the cart to buy,
   * checked to be non-empty and made of products that can still be bought.
   */
  private async loadCart(
    tx: TransactionClient,
    userId: string,
    idempotencyKey: string,
  ): Promise<{ existing: OrderWithItems } | { cart: CheckoutCart }> {
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

      return { existing: existingOrder };
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
      include: checkoutCartInclude,
      orderBy: {
        updatedAt: 'desc',
      },
    });

    const cart =
      candidateCarts.find((c) => c.cartItems.length > 0) ?? candidateCarts[0];

    if (!cart || cart.checkedOut) {
      throw new BadRequestException('Your cart has already been checked out.');
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

    return { cart };
  }

  /**
   * Brings the cart's prices up to the live ones (when revalidation is on) and returns the goods
   * subtotal, in Decimal throughout.
   */
  private async priceCart(
    tx: TransactionClient,
    cart: CheckoutCart,
  ): Promise<Prisma.Decimal> {
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

    return totalAmount;
  }

  /** Every voucher that applies, by the same engine the cart previewed with, and the amount to charge. */
  private async applyDiscounts(
    userId: string,
    dto: CheckoutDto,
    cart: CheckoutCart,
    totalAmount: Prisma.Decimal,
  ): Promise<CheckoutDiscounts> {
    // ---------------------------------------------------------------
    // DISCOUNT
    // ---------------------------------------------------------------

    let discountAmount = new Prisma.Decimal(0);
    let discountCode: string | null = null;

    // Every voucher applied to this order, with the amount IT took off.
    let appliedVouchers: Array<{
      id: string;
      code: string;
      amount: Prisma.Decimal;
    }> = [];

    // `discountCodes` (up to two, combinable) and the legacy single
    // `discountCode` are merged so older clients keep working.
    const requestedCodes = [
      ...(dto.discountCodes ?? []),
      ...(dto.discountCode ? [dto.discountCode] : []),
    ]
      .map((code) => code.trim())
      .filter(Boolean);

    // One engine for eligibility, minimum spend, stacking and amounts,
    // shared with the cart preview: each voucher is measured on the lines
    // it covers (a store voucher only ever covers that store's items),
    // never on the whole cart. strict: any rejected voucher fails the
    // checkout rather than silently charging a different price. Automatic
    // discounts (no code) are resolved here too, by the same engine the cart
    // previewed with, so the charged price is the price the shopper saw.
    const resolved = await this.discountCodeService.resolveVoucherStack(
      requestedCodes,
      userId,
      cart.cartItems.map((item) => ({
        productId: item.productId,
        vendorId: item.product.vendorId,
        categoryIds: [
          item.product.categoryId,
          ...(item.product.category?.parentId
            ? [item.product.category.parentId]
            : []),
        ],
        lineTotal: item.unitPrice.mul(item.quantity),
        quantity: item.quantity,
      })),
      { strict: true, includeAutomatic: true },
    );

    appliedVouchers = resolved.applied.map(
      ({ discount, discountAmount: amount }) => ({
        id: discount.id,
        code: discount.code,
        amount: amount.toDecimalPlaces(2),
      }),
    );
    discountAmount = resolved.totalDiscount;
    discountCode =
      appliedVouchers.length > 0
        ? appliedVouchers.map((v) => v.code).join(', ')
        : null;

    // The cart page shows delivery and service charges in its total, so
    // the charged amount must include them or the shopper would be shown
    // one price and billed another. Discounts apply to goods only.
    const finalAmount = Prisma.Decimal.max(
      totalAmount.sub(discountAmount),
      new Prisma.Decimal(0),
    )
      .add(cart.deliveryCharge ?? 0)
      .add(cart.serviceCharge ?? 0)
      .toDecimalPlaces(2);

    return { discountAmount, discountCode, appliedVouchers, finalAmount };
  }

  /**
   * Takes the stock for every line, one inventory row at a time in a fixed order (so concurrent
   * checkouts cannot deadlock), or fails with every unavailable line at once.
   */
  private async deductStock(
    tx: TransactionClient,
    userId: string,
    cart: CheckoutCart,
  ): Promise<void> {
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
      const label = item.variant ? variantLabel(item.variant.options) : null;

      const toShortfall = (available: number): StockShortfallItem => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        name: item.product.name,
        variantLabel: label,
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
  }

  /** Writes the order, its lines, history, payment row, voucher usage and idempotency record, and consumes the cart. */
  private async createOrder(
    tx: TransactionClient,
    input: CheckoutDiscounts & {
      userId: string;
      idempotencyKey: string;
      cart: CheckoutCart;
      shipping: { formattedAddress: string; addressId: string };
      totalAmount: Prisma.Decimal;
    },
  ): Promise<OrderWithItems> {
    const {
      userId,
      idempotencyKey,
      cart,
      shipping,
      totalAmount,
      discountAmount,
      discountCode,
      finalAmount,
      appliedVouchers,
    } = input;

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

        recommendationContext: item.recommendationContext ?? Prisma.DbNull,

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

    if (appliedVouchers.length > 0) {
      /**
       * Discount usage is recorded inside the same checkout transaction.
       *
       * This is critical:
       *
       * - the order cannot commit without its discount usage
       * - usage counters cannot commit without the order
       * - a failed checkout cannot consume the discount
       * - concurrent redemptions are serialized by recordUsage()
       *
       * Codes are locked in a fixed (id) order so two checkouts combining
       * the same pair of vouchers can never deadlock each other.
       */
      for (const voucher of [...appliedVouchers].sort((x, y) =>
        x.id.localeCompare(y.id),
      )) {
        await this.discountCodeService.recordUsage(
          voucher.id,
          order.id,
          userId,
          voucher.amount,
          tx,
        );
      }
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
}
