import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';

export type MarketplaceEventType =
  | 'STORE_VIEW'
  | 'CART_ADD'
  | 'CART_REMOVE'
  | 'WISHLIST_ADD'
  | 'WISHLIST_REMOVE';

export interface MarketplaceEventInput {
  id?: string;
  eventType: MarketplaceEventType;
  vendorId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  categoryId?: string | null;
  userId?: string | null;
  visitorId?: string | null;
  sessionId?: string | null;
  cartId?: string | null;
  quantity?: number | null;
  surface?: string | null;
}

@Injectable()
export class MarketplaceEventsService {
  private readonly logger = new Logger(MarketplaceEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordStoreView(
    vendorId: string,
    identity: { id: string; visitorId?: string; sessionId?: string },
    userId?: string,
  ): Promise<{ accepted: boolean }> {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, isActive: true, isApproved: true },
      select: { id: true },
    });
    if (!vendor) return { accepted: false };

    return this.record({
      id: identity.id,
      eventType: 'STORE_VIEW',
      vendorId: vendor.id,
      userId: userId ?? null,
      visitorId: identity.visitorId ?? null,
      sessionId: identity.sessionId ?? null,
      surface: 'VENDOR_STORE',
    });
  }

  /** Server-owned product/cart/wishlist actions. Analytics failures never fail commerce writes. */
  async record(input: MarketplaceEventInput): Promise<{ accepted: boolean }> {
    try {
      await this.prisma.marketplaceEvent.create({
        data: {
          id: input.id ?? randomUUID(),
          eventType: input.eventType,
          vendorId: input.vendorId ?? null,
          productId: input.productId ?? null,
          variantId: input.variantId ?? null,
          categoryId: input.categoryId ?? null,
          userId: input.userId ?? null,
          visitorId: input.visitorId ?? null,
          sessionId: input.sessionId ?? null,
          cartId: input.cartId ?? null,
          quantity: input.quantity ?? null,
          surface: input.surface ?? null,
        },
      });
      return { accepted: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { accepted: true };
      }
      this.logger.warn(
        `Could not record ${input.eventType}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { accepted: false };
    }
  }
}
