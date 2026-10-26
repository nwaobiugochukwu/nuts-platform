import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { Cron, CronExpression } from '@nestjs/schedule';

import { Prisma } from '@prisma/client';

import { CacheService } from '@api/modules/infrastructure/cache/cache.service';
import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import { DiscountCodeService } from '@api/modules/promotions/discount-code.service';
import { UsersService } from '@api/modules/users/users.service';
import { InsufficientStockException } from '@api/modules/shared/errors/insufficient-stock.exception';

import { UpdateCartItemDto } from './dto/update-cart-item.dto';

import { CartResponseDto } from './dto/cart-response.dto';
import { AddToCartResponseDto } from './dto/responses/add-to-cart.response';
import { ClearCartResponseDto } from './dto/responses/clear-cart.response';
import { GetCartResponseDto } from './dto/responses/get-cart.response';
import { RemoveCartItemResponseDto } from './dto/responses/remove-cart-item.response';
import { UpdateCartItemResponseDto } from './dto/responses/update-cart-item.response';

export const CART_CACHE_PREFIX = 'user:cart:v3:';

/*
 * Cart data is user-specific, so the cache key MUST contain the user ID.
 *
 * 60 seconds is deliberately short because product price/stock can change
 * independently of a cart mutation.
 */
const CART_CACHE_TTL = 60;

/*
 * Keep the product query focused on fields actually required by the cart.
 * Large `include` trees increase database work and network payload size.
 */
const CART_PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  price: true,
  stock: true,
  lowStockThreshold: true,
  hasVariants: true,
  description: true,
  isActive: true,
  isDeleted: true,

  images: {
    select: {
      url: true,
      isPrimary: true,
    },
    orderBy: {
      position: 'asc' as const,
    },
  },

  category: {
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,

      parent: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },

  vendor: {
    select: {
      id: true,
      storeName: true,
    },
  },
} satisfies Prisma.ProductSelect;

const CART_ITEM_INCLUDE = {
  product: {
    select: CART_PRODUCT_SELECT,
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
} satisfies Prisma.CartItemInclude;

const CART_INCLUDE = {
  cartItems: {
    include: CART_ITEM_INCLUDE,
  },
} satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{
  include: typeof CART_INCLUDE;
}>;

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly discountCodeService: DiscountCodeService,
    private readonly cacheService: CacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET CART
  // ---------------------------------------------------------------------------

  async getCart(userId: string): Promise<GetCartResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    const cacheKey = this.getCacheKey(userId);

    /*
     * Cart reads are cached because every request otherwise requires
     * multiple relational database reads.
     *
     * Mutations explicitly invalidate this key.
     */
    return this.cacheService.wrap(cacheKey, CART_CACHE_TTL, async () => {
      const cart = await this.getOrCreateActiveCart(userId);

      return this.toResponse(cart);
    });
  }

  // ---------------------------------------------------------------------------
  // DISCOUNT PREVIEW
  // ---------------------------------------------------------------------------

  async previewDiscount(userId: string, code: string) {
    await this.usersService.assertActiveAccount(userId);

    /*
     * We intentionally don't call getCart() here because that would introduce
     * another cache layer and potentially use a stale cart representation.
     *
     * We need the current database cart for discount validation.
     */
    const cart = await this.getOrCreateActiveCart(userId);

    const response = this.toResponse(cart);

    if (response.cartItems.length === 0) {
      throw new BadRequestException('Your cart is empty');
    }

    const subtotal = new Prisma.Decimal(response.cart.subtotal);

    const discountCode = await this.discountCodeService.validate(
      code,
      userId,
      subtotal,
    );

    if (
      discountCode.scope === 'VENDOR' &&
      !discountCode.platformwide &&
      discountCode.applicableProductIds.length > 0 &&
      !response.cartItems.some((item) =>
        discountCode.applicableProductIds.includes(item.productId),
      )
    ) {
      throw new BadRequestException(
        'This discount code does not apply to any products in your cart',
      );
    }

    const discountAmount = Number(
      this.discountCodeService.calculateDiscount(discountCode, subtotal),
    );

    const deliveryCharge = response.cart.deliveryCharge;

    const serviceCharge = response.cart.serviceCharge;

    const totalAmount = Math.max(
      0,
      response.cart.subtotal - discountAmount + deliveryCharge + serviceCharge,
    );

    return {
      code: discountCode.code,
      subtotal: response.cart.subtotal,
      discountAmount,
      deliveryCharge,
      serviceCharge,
      totalAmount,
    };
  }

  // ---------------------------------------------------------------------------
  // ADD TO CART
  // ---------------------------------------------------------------------------

  async addToCart(
    userId: string,
    productId: string,
    quantity: number,
    variantId?: string,
  ): Promise<AddToCartResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Quantity must be a positive integer');
    }

    let normalizedVariantId = this.normalizeVariantId(variantId);

    /*
     * Serializable transactions protect the read -> calculate -> update
     * sequence when two requests modify the same cart simultaneously.
     *
     * Example:
     *
     * Request A: quantity 2 -> wants +1
     * Request B: quantity 2 -> wants +1
     *
     * Without transaction isolation both could read 2 and incorrectly
     * produce 3 instead of 4.
     */
    await this.runSerializableTransaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: {
          id: productId,
          isActive: true,
          isDeleted: false,
        },
        select: {
          id: true,
          name: true,
          price: true,
          stock: true,
          hasVariants: true,
        },
      });

      if (!product) {
        throw new NotFoundException('Product not available');
      }

      const variant = normalizedVariantId
        ? await tx.productVariant.findFirst({
            where: {
              id: normalizedVariantId,
              productId,
              isActive: true,
              isDeleted: false,
            },
            select: {
              id: true,
              stock: true,
              options: true,
            },
          })
        : null;

      if (product.hasVariants && !normalizedVariantId) {
        throw new BadRequestException('Please select a product variant');
      }

      if (!product.hasVariants && normalizedVariantId) {
        normalizedVariantId = null;
      }

      if (normalizedVariantId && !variant) {
        throw new NotFoundException('Product variant not found or unavailable');
      }

      /*
       * Variant stock is authoritative for variant products.
       * Otherwise product-level stock is used.
       */
      const availableStock = variant?.stock ?? product.stock;

      const cart = await this.getOrCreateActiveCart(userId, tx);

      const existingItem = await tx.cartItem.findFirst({
        where: {
          cartId: cart.id,
          productId,
          variantId: normalizedVariantId,
        },
        select: {
          id: true,
          quantity: true,
        },
      });

      const newQuantity = (existingItem?.quantity ?? 0) + quantity;

      if (newQuantity > availableStock) {
        throw new InsufficientStockException([
          {
            productId,
            variantId: normalizedVariantId,
            name: product.name,
            variantLabel: variant ? this.variantLabel(variant.options) : null,
            requested: newQuantity,
            available: Math.max(0, availableStock),
          },
        ]);
      }

      /*
       * Store the current product price as the cart line price.
       *
       * IMPORTANT:
       * This is not trusted for final payment. Checkout must revalidate
       * price and stock again before creating the order.
       */
      const unitPrice = product.price;

      if (existingItem) {
        await tx.cartItem.update({
          where: {
            id: existingItem.id,
          },
          data: {
            quantity: newQuantity,
            unitPrice,
            totalPrice: unitPrice.mul(newQuantity),
          },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            productId,
            variantId: normalizedVariantId,
            quantity,
            unitPrice,
            totalPrice: unitPrice.mul(quantity),
          },
        });
      }
    });

    await this.invalidateCartCache(userId);

    const cart = await this.getOrCreateActiveCart(userId);

    const response = this.toResponse(cart);

    const addedItem = response.cartItems.find(
      (item) =>
        item.productId === productId &&
        (item.variant?.id ?? null) === normalizedVariantId,
    );

    if (!addedItem) {
      /*
       * This should never happen unless the database state changed
       * unexpectedly between the mutation and read.
       */
      throw new NotFoundException(
        'Cart item could not be loaded after being added',
      );
    }

    return {
      cart: response.cart,
      addedItem,
    };
  }

  // ---------------------------------------------------------------------------
  // UPDATE CART ITEM
  // ---------------------------------------------------------------------------

  async updateItem(
    userId: string,
    productId: string,
    variantId: string | undefined,
    dto: UpdateCartItemDto,
  ): Promise<UpdateCartItemResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    if (!Number.isInteger(dto.quantity) || dto.quantity === 0) {
      throw new BadRequestException(
        'Quantity change must be a non-zero integer',
      );
    }

    const normalizedVariantId = this.normalizeVariantId(variantId);

    await this.runSerializableTransaction(async (tx) => {
      let cartItem = await tx.cartItem.findFirst({
        where: {
          productId,
          variantId: normalizedVariantId,

          cart: {
            userId,
            checkedOut: false,
          },
        },

        select: {
          id: true,
          quantity: true,

          variant: {
            select: {
              stock: true,
              options: true,
              isActive: true,
              isDeleted: true,
            },
          },

          product: {
            select: {
              name: true,
              stock: true,
              isActive: true,
              isDeleted: true,
            },
          },
        },
      });

      if (!cartItem) {
        const candidates = await tx.cartItem.findMany({
          where: {
            productId,
            cart: {
              userId,
              checkedOut: false,
            },
          },
          select: {
            id: true,
            quantity: true,
            variant: {
              select: {
                stock: true,
                options: true,
                isActive: true,
                isDeleted: true,
              },
            },
            product: {
              select: {
                name: true,
                stock: true,
                isActive: true,
                isDeleted: true,
              },
            },
          },
        });

        if (candidates.length === 1) {
          cartItem = candidates[0];
        }
      }

      if (!cartItem) {
        throw new NotFoundException('Cart item not found');
      }

      if (
        !cartItem.product.isActive ||
        cartItem.product.isDeleted ||
        (cartItem.variant &&
          (!cartItem.variant.isActive || cartItem.variant.isDeleted))
      ) {
        /*
         * Don't allow users to keep increasing an item that is
         * no longer purchasable.
         */
        await tx.cartItem.delete({
          where: {
            id: cartItem.id,
          },
        });

        throw new BadRequestException('This product is no longer available');
      }

      const newQuantity = cartItem.quantity + dto.quantity;

      /*
       * Quantity <= 0 means remove.
       */
      if (newQuantity <= 0) {
        await tx.cartItem.delete({
          where: {
            id: cartItem.id,
          },
        });

        return;
      }

      const availableStock = cartItem.variant?.stock ?? cartItem.product.stock;

      if (newQuantity > availableStock) {
        throw new InsufficientStockException([
          {
            productId,
            variantId: normalizedVariantId,
            name: cartItem.product.name,
            variantLabel: cartItem.variant
              ? this.variantLabel(cartItem.variant.options)
              : null,
            requested: newQuantity,
            available: Math.max(0, availableStock),
          },
        ]);
      }

      /*
       * Re-read the live product price.
       *
       * A price may have changed since the item was originally
       * added to the cart.
       */
      const product = await tx.product.findFirst({
        where: {
          id: productId,
          isActive: true,
          isDeleted: false,
        },
        select: {
          price: true,
        },
      });

      if (!product) {
        throw new NotFoundException('Product is no longer available');
      }

      await tx.cartItem.update({
        where: {
          id: cartItem.id,
        },
        data: {
          quantity: newQuantity,
          unitPrice: product.price,
          totalPrice: product.price.mul(newQuantity),
        },
      });
    });

    await this.invalidateCartCache(userId);

    const cart = await this.getOrCreateActiveCart(userId);

    return this.toResponse(cart);
  }

  // ---------------------------------------------------------------------------
  // REMOVE ITEM
  // ---------------------------------------------------------------------------

  async removeItem(
    userId: string,
    productId: string,
    variantId?: string,
  ): Promise<RemoveCartItemResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    const normalizedVariantId = this.normalizeVariantId(variantId);

    let result = await this.prisma.cartItem.deleteMany({
      where: {
        productId,
        ...(normalizedVariantId ? { variantId: normalizedVariantId } : {}),

        cart: {
          userId,
          checkedOut: false,
        },
      },
    });

    if (result.count === 0 && normalizedVariantId) {
      result = await this.prisma.cartItem.deleteMany({
        where: {
          productId,
          cart: {
            userId,
            checkedOut: false,
          },
        },
      });
    }

    if (result.count > 0) {
      await this.invalidateCartCache(userId);
    }

    const cart = await this.getOrCreateActiveCart(userId);

    return {
      cart: this.toResponse(cart),
    };
  }

  // ---------------------------------------------------------------------------
  // CLEAR CART
  // ---------------------------------------------------------------------------

  async clearCart(userId: string): Promise<ClearCartResponseDto> {
    await this.usersService.assertActiveAccount(userId);

    await this.prisma.cartItem.deleteMany({
      where: {
        cart: {
          userId,
          checkedOut: false,
        },
      },
    });

    await this.invalidateCartCache(userId);

    const cart = await this.getOrCreateActiveCart(userId);

    return this.toResponse(cart);
  }

  // ---------------------------------------------------------------------------
  // ACTIVE CART
  // ---------------------------------------------------------------------------

  private async getOrCreateActiveCart(
    userId: string,
    prisma: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<CartWithItems> {
    // 1. Prioritize active cart that contains items, ordered by latest update
    let cart = await prisma.cart.findFirst({
      where: {
        userId,
        checkedOut: false,
        cartItems: { some: {} },
      },
      include: CART_INCLUDE,
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // 2. If no cart with items exists, find any unchecked-out cart
    if (!cart) {
      cart = await prisma.cart.findFirst({
        where: {
          userId,
          checkedOut: false,
        },
        include: CART_INCLUDE,
        orderBy: {
          updatedAt: 'desc',
        },
      });
    }

    if (!cart) {
      /*
       * The transaction isolation protects this creation when this method
       * is called as part of a serializable cart mutation.
       *
       * For the strongest guarantee, the database should also enforce
       * one active cart per user.
       */
      cart = await prisma.cart.create({
        data: {
          userId,
        },
        include: CART_INCLUDE,
      });
    } else if (cart.cartItems.length > 0 && prisma === this.prisma) {
      // Opportunistically purge duplicate empty active carts for this user
      void this.prisma.cart
        .deleteMany({
          where: {
            userId,
            checkedOut: false,
            id: { not: cart.id },
            cartItems: { none: {} },
          },
        })
        .catch(() => {});
    }

    return cart;
  }

  // ---------------------------------------------------------------------------
  // RESPONSE MAPPING
  // ---------------------------------------------------------------------------

  private toResponse(cart: CartWithItems): CartResponseDto {
    const cartItems = cart.cartItems
      .filter((item) => {
        /*
         * Invalid items are not returned to the client.
         *
         * They should normally be cleaned up by checkout/cart maintenance,
         * but filtering here prevents broken products from appearing.
         */
        if (!item.product || item.product.isDeleted || !item.product.isActive) {
          return false;
        }

        if (
          item.variant &&
          (item.variant.isDeleted || !item.variant.isActive)
        ) {
          return false;
        }

        if (item.variantId && !item.variant) {
          return false;
        }

        return true;
      })
      .map((item) => {
        const product = item.product;

        /*
         * Product price is the live price.
         *
         * This means a cached cart doesn't permanently display an old
         * price after a product price change. The cache TTL is still kept
         * short because stock and pricing are dynamic.
         */
        const price = Number(product.price);

        const inStockQuantity = item.variantId
          ? (item.variant?.stock ?? 0)
          : product.stock;

        const isVariant = Boolean(item.variantId);

        const lowStockQuantity = product.lowStockThreshold;

        const lowStockAlert = inStockQuantity <= lowStockQuantity;

        const directCategory = product.category
          ? {
              id: product.category.id,
              name: product.category.name,
              slug: product.category.slug,
            }
          : undefined;

        const parentCategory = product.category?.parent
          ? {
              id: product.category.parent.id,
              name: product.category.parent.name,
              slug: product.category.parent.slug,
            }
          : undefined;

        const category = product.category?.parentId
          ? parentCategory
          : directCategory;

        const subcategory = product.category?.parentId
          ? directCategory
          : undefined;

        return {
          id: item.id,
          cartId: item.cartId,
          productId: item.productId,

          product: {
            id: product.id,
            name: product.name,
            slug: product.slug,
            sku: product.sku,

            price,

            inStockQuantity,

            hasVariants: product.hasVariants,

            description: product.description ?? undefined,

            isActive: product.isActive,

            isVariant,

            lowStockAlert,
            lowStockQuantity,

            hasDiscount: false,
            discountDetails: null,

            imageUrl: product.images[0]?.url ?? null,

            images: product.images.map((image) => ({
              url: image.url,
            })),

            category,
            subcategory,

            vendor: product.vendor
              ? {
                  id: product.vendor.id,
                  name: product.vendor.storeName,
                }
              : undefined,

            productAvailability: {
              canAddToCart:
                product.isActive && !product.isDeleted && inStockQuantity > 0,

              isAvailable: product.isActive && !product.isDeleted,

              sku: product.sku,
            },
          },

          variant: item.variant
            ? {
                id: item.variant.id,

                options: this.transformOptions(item.variant.options),

                isActive: item.variant.isActive,

                isDeleted: item.variant.isDeleted,
              }
            : null,

          quantity: item.quantity,

          /*
           * Use the live price rather than trusting the persisted
           * cartItem.unitPrice for presentation.
           */
          price,

          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      });

    const subtotal = cartItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const discountAmount = Number(cart.discountAmount);

    const deliveryCharge = Number(cart.deliveryCharge);

    const serviceCharge = Number(cart.serviceCharge);

    const totalAmount = Math.max(
      0,
      subtotal - discountAmount + deliveryCharge + serviceCharge,
    );

    const totalItemCount = cartItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );

    return {
      cart: {
        id: cart.id,
        userId: cart.userId,

        subtotal,

        discountAmount,

        deliveryCharge,

        serviceCharge,

        totalAmount,

        totalItemCount,

        abandonedCartAlerted: cart.abandonedCartAlerted ?? false,

        createdAt: cart.createdAt,

        updatedAt: cart.updatedAt,

        checkedOut: cart.checkedOut,
      },

      cartItems,
    };
  }

  // ---------------------------------------------------------------------------
  // OPTION NORMALIZATION
  // ---------------------------------------------------------------------------

  private transformOptions(
    options: unknown,
  ): { name: string; value: string }[] {
    if (!options) {
      return [];
    }

    /*
     * Current format:
     *
     * [
     *   { name: "Color", value: "Black" },
     *   { name: "Size", value: "M" }
     * ]
     */
    if (Array.isArray(options)) {
      return options
        .filter(
          (
            option,
          ): option is {
            name: string;
            value: string;
          } =>
            typeof option === 'object' &&
            option !== null &&
            'name' in option &&
            'value' in option,
        )
        .map((option) => ({
          name: String(option.name),
          value: String(option.value),
        }));
    }

    /*
     * Legacy format:
     *
     * {
     *   Color: "Black",
     *   Size: "M"
     * }
     */
    if (typeof options === 'object') {
      return Object.entries(options as Record<string, unknown>).map(
        ([name, value]) => ({
          name,
          value: String(value),
        }),
      );
    }

    return [];
  }

  private variantLabel(options: unknown): string | null {
    const list = this.transformOptions(options);
    if (!list.length) return null;
    return list.map((o) => `${o.name}: ${o.value}`).join(', ');
  }

  // ---------------------------------------------------------------------------
  // CACHE
  // ---------------------------------------------------------------------------

  private getCacheKey(userId: string): string {
    return `${CART_CACHE_PREFIX}${userId}`;
  }

  private async invalidateCartCache(userId: string): Promise<void> {
    await this.cacheService.del(this.getCacheKey(userId));
  }

  // ---------------------------------------------------------------------------
  // SERIALIZABLE TRANSACTION HELPER
  // ---------------------------------------------------------------------------

  private async runSerializableTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    /*
     * PostgreSQL can abort a serializable transaction with P2034 when
     * another transaction modified the same data concurrently.
     *
     * Retrying a small number of times is standard for this pattern.
     */
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(callback, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,

          maxWait: 5_000,
          timeout: 10_000,
        });
      } catch (error) {
        const isSerializationConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';

        if (!isSerializationConflict || attempt === MAX_RETRIES) {
          throw error;
        }

        this.logger.warn(
          `Cart transaction conflict. Retrying attempt ${attempt + 1}/${MAX_RETRIES}`,
        );
      }
    }

    throw new Error('Cart transaction failed after retries');
  }

  // ---------------------------------------------------------------------------
  // NORMALIZATION
  // ---------------------------------------------------------------------------

  private normalizeVariantId(
    variantId: string | null | undefined,
  ): string | null {
    const normalized = variantId?.trim();

    return normalized || null;
  }

  // ---------------------------------------------------------------------------
  // ABANDONED CART CLEANUP
  // ---------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeAbandonedCarts(): Promise<void> {
    const cutoff = new Date();

    cutoff.setDate(cutoff.getDate() - 30);

    this.logger.log(`Purging carts not updated since ${cutoff.toISOString()}`);

    const result = await this.prisma.cart.deleteMany({
      where: {
        checkedOut: false,

        updatedAt: {
          lte: cutoff,
        },
      },
    });

    this.logger.log(`Purged ${result.count} abandoned carts`);
  }
}
