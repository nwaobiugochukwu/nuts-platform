import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import {
  MarketplaceAnalyticsSummaryDto,
  VendorProductPerformancePageDto,
} from './dto/marketplace-analytics.dto';

type AggregateValue = bigint | number | string | null;
type SummaryRow = Record<string, AggregateValue>;

function count(value: AggregateValue): number {
  return Number(value ?? 0);
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0
    ? Number(((numerator / denominator) * 100).toFixed(1))
    : 0;
}

@Injectable()
export class MarketplaceAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(
    start: Date,
    end: Date,
    vendorId?: string,
  ): Promise<MarketplaceAnalyticsSummaryDto> {
    const vendorFilter = vendorId ?? null;
    const [
      events,
      topFollowerStores,
      views,
      sales,
      cartConversion,
      viewerConversion,
      followerTotals,
      followerChanges,
    ] = await Promise.all([
      this.prisma.$queryRaw<SummaryRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE "event_type" = 'STORE_VIEW') AS store_views,
          COUNT(DISTINCT COALESCE(
            CASE WHEN "user_id" IS NOT NULL THEN 'u:' || "user_id" END,
            CASE WHEN "visitor_id" IS NOT NULL THEN 'v:' || "visitor_id" END,
            CASE WHEN "session_id" IS NOT NULL THEN 's:' || "session_id" END,
            'e:' || "id"
          )) FILTER (WHERE "event_type" = 'STORE_VIEW') AS unique_store_visitors,
          COUNT(*) FILTER (WHERE "event_type" = 'CART_ADD') AS cart_adds,
          COUNT(DISTINCT "user_id") FILTER (WHERE "event_type" = 'CART_ADD') AS unique_cart_adders,
          COUNT(*) FILTER (WHERE "event_type" = 'CART_REMOVE') AS cart_removals,
          COUNT(*) FILTER (WHERE "event_type" = 'WISHLIST_ADD') AS wishlist_adds,
          COUNT(DISTINCT "user_id") FILTER (WHERE "event_type" = 'WISHLIST_ADD') AS unique_wishlist_savers,
          COUNT(*) FILTER (WHERE "event_type" = 'WISHLIST_REMOVE') AS wishlist_removals,
          COUNT(DISTINCT ("cart_id", "product_id", "variant_id"))
            FILTER (WHERE "event_type" = 'CART_ADD' AND "cart_id" IS NOT NULL) AS cart_lines_added
        FROM "marketplace_events"
        WHERE "created_at" >= ${start} AND "created_at" <= ${end}
          AND (${vendorFilter}::text IS NULL OR "vendor_id" = ${vendorFilter})
      `,
      this.prisma.$queryRaw<
        Array<{
          vendor_id: string;
          store_name: string;
          follower_count: AggregateValue;
        }>
      >`
        SELECT
          v.id AS vendor_id,
          v."storeName" AS store_name,
          COUNT(vf.id) FILTER (WHERE u.id IS NOT NULL) AS follower_count
        FROM "vendors" v
        LEFT JOIN "vendor_follows" vf ON vf."vendor_id" = v.id
        LEFT JOIN "users" u ON u.id = vf."user_id" AND u."isActive" = TRUE
        WHERE v."isActive" = TRUE
          AND v."isApproved" = TRUE
          AND (${vendorFilter}::text IS NULL OR v.id = ${vendorFilter})
        GROUP BY v.id, v."storeName"
        HAVING COUNT(vf.id) FILTER (WHERE u.id IS NOT NULL) > 0
        ORDER BY follower_count DESC, v."storeName" ASC
        LIMIT 5
      `,
      this.prisma.$queryRaw<SummaryRow[]>`
        SELECT
          COUNT(*) AS product_views,
          COUNT(DISTINCT COALESCE(
            CASE WHEN pv."userId" IS NOT NULL THEN 'u:' || pv."userId" END,
            CASE WHEN pv."visitor_id" IS NOT NULL THEN 'v:' || pv."visitor_id" END,
            CASE WHEN pv."sessionId" IS NOT NULL THEN 's:' || pv."sessionId" END,
            'view:' || pv.id
          )) AS unique_product_viewers
        FROM "product_views" pv
        JOIN "products" p ON p.id = pv."productId"
        WHERE pv."createdAt" >= ${start} AND pv."createdAt" <= ${end}
          AND p."isDeleted" = FALSE
          AND (${vendorFilter}::text IS NULL OR p."vendorId" = ${vendorFilter})
      `,
      this.prisma.$queryRaw<SummaryRow[]>`
        SELECT
          COUNT(DISTINCT o.id) AS paid_orders,
          COALESCE(SUM(oi.quantity), 0) AS paid_units,
          COALESCE(SUM(oi."totalPrice"), 0) AS paid_revenue
        FROM "order_items" oi
        JOIN "orders" o ON o.id = oi."orderId"
        JOIN "payments" pay ON pay."orderId" = o.id AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
        WHERE o."createdAt" >= ${start} AND o."createdAt" <= ${end}
          AND o.status != 'CANCELLED'
          AND (${vendorFilter}::text IS NULL OR oi."vendorId" = ${vendorFilter})
      `,
      this.prisma.$queryRaw<SummaryRow[]>`
        WITH additions AS (
          SELECT e."cart_id", e."product_id", e."variant_id", MAX(e."created_at") AS added_at
          FROM "marketplace_events" e
          WHERE e."event_type" = 'CART_ADD'
            AND e."created_at" >= ${start} AND e."created_at" <= ${end}
            AND e."cart_id" IS NOT NULL
            AND (${vendorFilter}::text IS NULL OR e."vendor_id" = ${vendorFilter})
          GROUP BY e."cart_id", e."product_id", e."variant_id"
        )
        SELECT
          COUNT(*) AS cart_lines_added,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1
            FROM "orders" o
            JOIN "payments" pay ON pay."orderId" = o.id AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
            JOIN "order_items" oi ON oi."orderId" = o.id
            WHERE o."cartId" = additions."cart_id"
              AND o.status != 'CANCELLED'
              AND o."createdAt" >= additions.added_at
              AND o."createdAt" <= additions.added_at + INTERVAL '7 days'
              AND oi."productId" = additions."product_id"
              AND oi."variantId" IS NOT DISTINCT FROM additions."variant_id"
              AND (${vendorFilter}::text IS NULL OR oi."vendorId" = ${vendorFilter})
          )) AS purchased_cart_lines
        FROM additions
      `,
      this.prisma.$queryRaw<SummaryRow[]>`
        WITH identified_viewers AS (
          SELECT DISTINCT pv."productId" AS product_id, pv."userId" AS user_id
          FROM "product_views" pv
          JOIN "products" p ON p.id = pv."productId"
          WHERE pv."userId" IS NOT NULL
            AND pv."createdAt" >= ${start} AND pv."createdAt" <= ${end}
            AND p."isDeleted" = FALSE
            AND (${vendorFilter}::text IS NULL OR p."vendorId" = ${vendorFilter})
        )
        SELECT
          COUNT(*) AS identified_viewers,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM "marketplace_events" e
            WHERE e."event_type" = 'CART_ADD'
              AND e."product_id" = identified_viewers.product_id
              AND e."user_id" = identified_viewers.user_id
              AND (${vendorFilter}::text IS NULL OR e."vendor_id" = ${vendorFilter})
              AND EXISTS (
                SELECT 1 FROM "product_views" attributed_view
                WHERE attributed_view."productId" = identified_viewers.product_id
                  AND attributed_view."userId" = identified_viewers.user_id
                  AND attributed_view."createdAt" >= ${start}
                  AND attributed_view."createdAt" <= ${end}
                  AND e."created_at" >= attributed_view."createdAt"
                  AND e."created_at" <= attributed_view."createdAt" + INTERVAL '7 days'
              )
          )) AS viewers_who_added,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM "order_items" oi
            JOIN "orders" o ON o.id = oi."orderId"
            JOIN "payments" pay ON pay."orderId" = o.id AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
            WHERE oi."productId" = identified_viewers.product_id
              AND o."userId" = identified_viewers.user_id
              AND o.status != 'CANCELLED'
              AND (${vendorFilter}::text IS NULL OR oi."vendorId" = ${vendorFilter})
              AND EXISTS (
                SELECT 1 FROM "product_views" attributed_view
                WHERE attributed_view."productId" = identified_viewers.product_id
                  AND attributed_view."userId" = identified_viewers.user_id
                  AND attributed_view."createdAt" >= ${start}
                  AND attributed_view."createdAt" <= ${end}
                  AND o."createdAt" >= attributed_view."createdAt"
                  AND o."createdAt" <= attributed_view."createdAt" + INTERVAL '7 days'
              )
          )) AS viewers_who_purchased
        FROM identified_viewers
      `,
      this.prisma.$queryRaw<SummaryRow[]>`
        SELECT
          COUNT(*) AS current_followers,
          COUNT(DISTINCT vf."user_id") AS unique_followers
        FROM "vendor_follows" vf
        JOIN "users" u ON u.id = vf."user_id" AND u."isActive" = TRUE
        JOIN "vendors" v ON v.id = vf."vendor_id"
          AND v."isActive" = TRUE
          AND v."isApproved" = TRUE
        WHERE (${vendorFilter}::text IS NULL OR vf."vendor_id" = ${vendorFilter})
      `,
      this.prisma.$queryRaw<SummaryRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE "event_type" = 'FOLLOW') AS new_followers,
          COUNT(*) FILTER (WHERE "event_type" = 'UNFOLLOW') AS unfollows
        FROM "recommendation_events"
        WHERE "surface" = 'VENDOR_STORE'
          AND "event_type" IN ('FOLLOW', 'UNFOLLOW')
          AND "request_id" IS NULL
          AND "user_id" IS NOT NULL
          AND "created_at" >= ${start} AND "created_at" <= ${end}
          AND (${vendorFilter}::text IS NULL OR "vendor_id" = ${vendorFilter})
      `,
    ]);

    const event = events[0] ?? {};
    const view = views[0] ?? {};
    const sale = sales[0] ?? {};
    const conversion = cartConversion[0] ?? {};
    const viewer = viewerConversion[0] ?? {};
    const followerTotal = followerTotals[0] ?? {};
    const followerChange = followerChanges[0] ?? {};
    const cartLinesAdded = count(
      conversion.cart_lines_added ?? event.cart_lines_added,
    );
    const cartLinesPurchased = count(conversion.purchased_cart_lines);

    return {
      storeViews: count(event.store_views),
      uniqueStoreVisitors: count(event.unique_store_visitors),
      productViews: count(view.product_views),
      uniqueProductViewers: count(view.unique_product_viewers),
      cartAdds: count(event.cart_adds),
      uniqueCartAdders: count(event.unique_cart_adders),
      cartRemovals: count(event.cart_removals),
      wishlistAdds: count(event.wishlist_adds),
      uniqueWishlistSavers: count(event.unique_wishlist_savers),
      wishlistRemovals: count(event.wishlist_removals),
      cartLinesAdded,
      cartLinesPurchased,
      cartToPurchaseRate: rate(cartLinesPurchased, cartLinesAdded),
      identifiedProductViewers: count(viewer.identified_viewers),
      viewersToCart: count(viewer.viewers_who_added),
      viewersToPurchase: count(viewer.viewers_who_purchased),
      productViewToCartRate: rate(
        count(viewer.viewers_who_added),
        count(viewer.identified_viewers),
      ),
      productViewToPurchaseRate: rate(
        count(viewer.viewers_who_purchased),
        count(viewer.identified_viewers),
      ),
      currentFollowers: count(followerTotal.current_followers),
      uniqueFollowers: count(followerTotal.unique_followers),
      newFollowers: count(followerChange.new_followers),
      unfollows: count(followerChange.unfollows),
      netFollowerGrowth:
        count(followerChange.new_followers) - count(followerChange.unfollows),
      topFollowerStores: topFollowerStores.map((row) => ({
        vendorId: row.vendor_id,
        storeName: row.store_name,
        followerCount: count(row.follower_count),
      })),
      paidOrders: count(sale.paid_orders),
      paidUnits: count(sale.paid_units),
      paidRevenue: Number(sale.paid_revenue ?? 0).toFixed(2),
    };
  }

  async getVendorProducts(
    vendorId: string,
    start: Date,
    end: Date,
    page = 1,
    limit = 20,
  ): Promise<VendorProductPerformancePageDto> {
    const offset = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>`
        WITH views AS (
          SELECT pv."productId" AS product_id,
                 COUNT(*) AS views,
                 COUNT(DISTINCT COALESCE(
                   CASE WHEN pv."userId" IS NOT NULL THEN 'u:' || pv."userId" END,
                   CASE WHEN pv."visitor_id" IS NOT NULL THEN 'v:' || pv."visitor_id" END,
                   CASE WHEN pv."sessionId" IS NOT NULL THEN 's:' || pv."sessionId" END,
                   'view:' || pv.id
                 )) AS unique_viewers
          FROM "product_views" pv
          JOIN "products" viewed_product ON viewed_product.id = pv."productId"
          WHERE pv."createdAt" >= ${start} AND pv."createdAt" <= ${end}
            AND viewed_product."vendorId" = ${vendorId}
            AND viewed_product."isDeleted" = FALSE
          GROUP BY pv."productId"
        ), actions AS (
          SELECT "product_id",
                 COUNT(*) FILTER (WHERE "event_type" = 'CART_ADD') AS cart_adds,
                 COUNT(*) FILTER (WHERE "event_type" = 'WISHLIST_ADD') AS wishlist_adds
          FROM "marketplace_events"
          WHERE "vendor_id" = ${vendorId}
            AND "created_at" >= ${start} AND "created_at" <= ${end}
          GROUP BY "product_id"
        ), identified_viewers AS (
          SELECT DISTINCT pv."productId" AS product_id, pv."userId" AS user_id
          FROM "product_views" pv
          JOIN "products" viewed_product ON viewed_product.id = pv."productId"
          WHERE viewed_product."vendorId" = ${vendorId}
            AND viewed_product."isDeleted" = FALSE
            AND pv."userId" IS NOT NULL
            AND pv."createdAt" >= ${start} AND pv."createdAt" <= ${end}
        ), view_rates AS (
          SELECT iv.product_id,
                 COUNT(*) AS identified_viewers,
                 COUNT(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM "marketplace_events" e
                   WHERE e."event_type" = 'CART_ADD'
                     AND e."product_id" = iv.product_id
                     AND e."user_id" = iv.user_id
                     AND e."vendor_id" = ${vendorId}
                     AND EXISTS (
                       SELECT 1 FROM "product_views" attributed_view
                       WHERE attributed_view."productId" = iv.product_id
                         AND attributed_view."userId" = iv.user_id
                         AND attributed_view."createdAt" >= ${start}
                         AND attributed_view."createdAt" <= ${end}
                         AND e."created_at" >= attributed_view."createdAt"
                         AND e."created_at" <= attributed_view."createdAt" + INTERVAL '7 days'
                     )
                 )) AS viewers_to_cart,
                 COUNT(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM "order_items" oi
                   JOIN "orders" o ON o.id = oi."orderId"
                   JOIN "payments" pay ON pay."orderId" = o.id
                     AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
                   WHERE oi."productId" = iv.product_id
                     AND oi."vendorId" = ${vendorId}
                     AND o."userId" = iv.user_id
                     AND o.status != 'CANCELLED'
                     AND EXISTS (
                       SELECT 1 FROM "product_views" attributed_view
                       WHERE attributed_view."productId" = iv.product_id
                         AND attributed_view."userId" = iv.user_id
                         AND attributed_view."createdAt" >= ${start}
                         AND attributed_view."createdAt" <= ${end}
                         AND o."createdAt" >= attributed_view."createdAt"
                         AND o."createdAt" <= attributed_view."createdAt" + INTERVAL '7 days'
                     )
                 )) AS viewers_to_purchase
          FROM identified_viewers iv
          GROUP BY iv.product_id
        ), cart_lines AS (
          SELECT e."cart_id", e."product_id", e."variant_id", MAX(e."created_at") AS added_at
          FROM "marketplace_events" e
          WHERE e."vendor_id" = ${vendorId}
            AND e."event_type" = 'CART_ADD'
            AND e."created_at" >= ${start} AND e."created_at" <= ${end}
            AND e."cart_id" IS NOT NULL
          GROUP BY e."cart_id", e."product_id", e."variant_id"
        ), cart_rates AS (
          SELECT cl."product_id",
                 COUNT(*) AS cart_lines_added,
                 COUNT(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM "orders" o
                   JOIN "payments" pay ON pay."orderId" = o.id
                     AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
                   JOIN "order_items" oi ON oi."orderId" = o.id
                   WHERE o."cartId" = cl."cart_id"
                     AND oi."productId" = cl."product_id"
                     AND oi."vendorId" = ${vendorId}
                     AND oi."variantId" IS NOT DISTINCT FROM cl."variant_id"
                     AND o.status != 'CANCELLED'
                     AND o."createdAt" >= cl.added_at
                     AND o."createdAt" <= cl.added_at + INTERVAL '7 days'
                 )) AS cart_lines_purchased
          FROM cart_lines cl
          GROUP BY cl."product_id"
        ), purchases AS (
          SELECT oi."productId" AS product_id,
                 COUNT(DISTINCT o.id) AS paid_orders,
                 COALESCE(SUM(oi.quantity), 0) AS paid_units,
                 COALESCE(SUM(oi."totalPrice"), 0) AS paid_revenue
          FROM "order_items" oi
          JOIN "orders" o ON o.id = oi."orderId"
          JOIN "payments" pay ON pay."orderId" = o.id AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
          WHERE oi."vendorId" = ${vendorId}
            AND o."createdAt" >= ${start} AND o."createdAt" <= ${end}
            AND o.status != 'CANCELLED'
          GROUP BY oi."productId"
        )
        SELECT p.id, p.name, p.sku, p."isActive", c.name AS category_name,
               COALESCE(v.views, 0) AS views,
               COALESCE(v.unique_viewers, 0) AS unique_viewers,
               COALESCE(a.cart_adds, 0) AS cart_adds,
               COALESCE(a.wishlist_adds, 0) AS wishlist_adds,
               COALESCE(vr.identified_viewers, 0) AS identified_viewers,
               COALESCE(vr.viewers_to_cart, 0) AS viewers_to_cart,
               COALESCE(vr.viewers_to_purchase, 0) AS viewers_to_purchase,
               COALESCE(cr.cart_lines_added, 0) AS cart_lines_added,
               COALESCE(cr.cart_lines_purchased, 0) AS cart_lines_purchased,
               COALESCE(pu.paid_orders, 0) AS paid_orders,
               COALESCE(pu.paid_units, 0) AS paid_units,
               COALESCE(pu.paid_revenue, 0) AS paid_revenue
        FROM "products" p
        LEFT JOIN "categories" c ON c.id = p."categoryId"
        LEFT JOIN views v ON v.product_id = p.id
        LEFT JOIN actions a ON a."product_id" = p.id
        LEFT JOIN view_rates vr ON vr.product_id = p.id
        LEFT JOIN cart_rates cr ON cr."product_id" = p.id
        LEFT JOIN purchases pu ON pu.product_id = p.id
        WHERE p."vendorId" = ${vendorId} AND p."isDeleted" = FALSE
        ORDER BY COALESCE(pu.paid_revenue, 0) DESC,
                 COALESCE(v.views, 0) DESC, p."createdAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      this.prisma.product.count({ where: { vendorId, isDeleted: false } }),
    ]);

    const totalCount = Number(total);
    return {
      items: rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        sku: String(row.sku),
        categoryName:
          typeof row.category_name === 'string'
            ? row.category_name
            : 'Uncategorized',
        isActive: Boolean(row.isActive),
        views: count(row.views as AggregateValue),
        uniqueViewers: count(row.unique_viewers as AggregateValue),
        cartAdds: count(row.cart_adds as AggregateValue),
        wishlistAdds: count(row.wishlist_adds as AggregateValue),
        identifiedViewers: count(row.identified_viewers as AggregateValue),
        viewersToCart: count(row.viewers_to_cart as AggregateValue),
        viewersToPurchase: count(row.viewers_to_purchase as AggregateValue),
        paidOrders: count(row.paid_orders as AggregateValue),
        paidUnits: count(row.paid_units as AggregateValue),
        paidRevenue: Number(row.paid_revenue ?? 0).toFixed(2),
        cartLinesAdded: count(row.cart_lines_added as AggregateValue),
        cartLinesPurchased: count(row.cart_lines_purchased as AggregateValue),
        cartToPurchaseRate: rate(
          count(row.cart_lines_purchased as AggregateValue),
          count(row.cart_lines_added as AggregateValue),
        ),
        productViewToCartRate: rate(
          count(row.viewers_to_cart as AggregateValue),
          count(row.identified_viewers as AggregateValue),
        ),
        productViewToPurchaseRate: rate(
          count(row.viewers_to_purchase as AggregateValue),
          count(row.identified_viewers as AggregateValue),
        ),
      })),
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }
}
