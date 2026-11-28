import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Injectable } from '@nestjs/common';
import type {
  DiscountCodeRow,
  OrderRow,
  SearchIndex,
  SearchResultItem,
  UserRow,
} from '../types/search.types';
import { SIMILARITY_THRESHOLD } from '../constants/search.constants';
import { CatalogIndexSearchService } from './catalog-index-search.service';
import type { IndexHits } from './search-runner.service';

/**
 * Searches every index an administrator can see: the catalogue ones plus users, orders and discount
 * codes. The three admin-only indexes live here and nowhere a shopper's search can reach.
 */
@Injectable()
export class AdminIndexSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogIndexSearchService,
  ) {}

  search(index: SearchIndex, term: string, limit: number): Promise<IndexHits> {
    switch (index) {
      case 'users':
        return this.users(term, limit);
      case 'orders':
        return this.orders(term, limit);
      case 'discount_codes':
        return this.discountCodes(term, limit);
      default:
        return this.catalog.search(index, term, limit);
    }
  }

  async users(
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;
    const prefixPattern = `${search}%`;

    const rows = await this.prisma.$queryRaw<UserRow[]>`
        SELECT
          u.id,
          u.email,
          u."firstName",
          u."lastName",
          rc.code AS "referralCode",
          (
            CASE
              WHEN LOWER(u.email) = LOWER(${search})
                THEN 10.0 + similarity(u.email, ${search})
              WHEN u.email ILIKE ${prefixPattern}
                THEN 6.0 + similarity(u.email, ${search})
              WHEN LOWER(COALESCE(rc.code, '')) = LOWER(${search})
                THEN 8.0
              WHEN rc.code ILIKE ${prefixPattern}
                THEN 5.0
              WHEN u.email ILIKE ${pattern}
                THEN 3.0 + similarity(u.email, ${search})
              WHEN rc.code ILIKE ${pattern}
                THEN 2.5 + similarity(rc.code, ${search})
              WHEN u."firstName" ILIKE ${pattern}
                OR u."lastName" ILIKE ${pattern}
                THEN 2.0 + similarity(
                  COALESCE(u."firstName", '') || ' ' ||
                  COALESCE(u."lastName", ''),
                  ${search}
                )
              ELSE similarity(u.email, ${search})
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM users u
        LEFT JOIN referral_codes rc
          ON rc."userId" = u.id
        WHERE
          u.email ILIKE ${pattern}
          OR u."firstName" ILIKE ${pattern}
          OR u."lastName" ILIKE ${pattern}
          OR rc.code ILIKE ${pattern}
          OR similarity(u.email, ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(COALESCE(u."firstName", ''), ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(COALESCE(u."lastName", ''), ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(COALESCE(rc.code, ''), ${search}) > ${SIMILARITY_THRESHOLD}
        ORDER BY score DESC, u."createdAt" DESC
        LIMIT ${limit};
      `;

    return {
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,

      items: rows.map((user) => ({
        id: user.id,
        index: 'users',
        type: 'user',
        title: user.email,
        subtitle: [user.firstName, user.lastName].filter(Boolean).join(' '),
        score: Number(user.score),
        payload: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          referralCode: user.referralCode
            ? {
                code: user.referralCode,
              }
            : null,
        },
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // ORDERS
  // ---------------------------------------------------------------------------

  async orders(
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;
    const prefixPattern = `${search}%`;

    const rows = await this.prisma.$queryRaw<OrderRow[]>`
        SELECT
          o.id,
          o."orderNumber",
          o.status,
          o."discountCode",
          o."referralCode",
          o."shippingAddress",
          u.email AS "userEmail",
          (
            CASE
              WHEN LOWER(o."orderNumber") = LOWER(${search})
                THEN 10.0 + similarity(o."orderNumber", ${search})
              WHEN o."orderNumber" ILIKE ${prefixPattern}
                THEN 6.0 + similarity(o."orderNumber", ${search})
              WHEN LOWER(COALESCE(u.email, '')) = LOWER(${search})
                THEN 5.0
              WHEN o."orderNumber" ILIKE ${pattern}
                THEN 3.0 + similarity(o."orderNumber", ${search})
              WHEN o."discountCode" ILIKE ${pattern}
                THEN 2.5 + similarity(o."discountCode", ${search})
              WHEN o."referralCode" ILIKE ${pattern}
                THEN 2.5 + similarity(o."referralCode", ${search})
              WHEN u.email ILIKE ${pattern}
                THEN 2.0 + similarity(u.email, ${search})
              ELSE similarity(
                COALESCE(
                  o."shippingAddress",
                  ''
                ),
                ${search}
              )
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM orders o
        LEFT JOIN users u
          ON u.id = o."userId"
        WHERE
          o."orderNumber" ILIKE ${pattern}
          OR o."discountCode" ILIKE ${pattern}
          OR o."referralCode" ILIKE ${pattern}
          OR o."shippingAddress" ILIKE ${pattern}
          OR u.email ILIKE ${pattern}
          OR similarity(o."orderNumber", ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(COALESCE(o."shippingAddress", ''), ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(u.email, ${search}) > ${SIMILARITY_THRESHOLD}
        ORDER BY score DESC, o."createdAt" DESC
        LIMIT ${limit};
      `;

    return {
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,

      items: rows.map((order) => ({
        id: order.id,
        index: 'orders',
        type: 'order',
        title: order.orderNumber,
        subtitle: [order.userEmail, order.status, order.shippingAddress]
          .filter(Boolean)
          .join(' â€¢ '),
        score: Number(order.score),
        payload: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          discountCode: order.discountCode,
          referralCode: order.referralCode,
          shippingAddress: order.shippingAddress,
          user: order.userEmail
            ? {
                email: order.userEmail,
              }
            : null,
        },
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // DISCOUNT CODES
  // ---------------------------------------------------------------------------

  async discountCodes(
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;
    const prefixPattern = `${search}%`;

    const rows = await this.prisma.$queryRaw<DiscountCodeRow[]>`
        SELECT
          id,
          code,
          description,
          (
            CASE
              WHEN LOWER(code) = LOWER(${search})
                THEN 10.0 + similarity(code, ${search})
              WHEN code ILIKE ${prefixPattern}
                THEN 6.0 + similarity(code, ${search})
              WHEN code ILIKE ${pattern}
                THEN 3.0 + similarity(code, ${search})
              WHEN description ILIKE ${pattern}
                THEN 1.0 + similarity(
                  COALESCE(description, ''),
                  ${search}
                )
              ELSE similarity(
                code,
                ${search}
              )
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM discount_codes
        WHERE
          code ILIKE ${pattern}
          OR COALESCE(description, '') ILIKE ${pattern}
          OR similarity(code, ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(
            COALESCE(description, ''),
            ${search}
          ) > ${SIMILARITY_THRESHOLD}
        ORDER BY score DESC, "createdAt" DESC
        LIMIT ${limit};
      `;

    return {
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,

      items: rows.map((discountCode) => ({
        id: discountCode.id,
        index: 'discount_codes',
        type: 'discount_code',
        title: discountCode.code,
        subtitle: discountCode.description ?? undefined,
        score: Number(discountCode.score),
        payload: {
          id: discountCode.id,
          code: discountCode.code,
          description: discountCode.description,
        },
      })),
    };
  }
}
