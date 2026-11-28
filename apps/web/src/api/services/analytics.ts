import { adminApi, publicApi, userApi, vendorApi } from "@/api/core/client";
import { createRecommendationRequestId } from "@/lib/recommendation-session";
import { getQueryClient } from "@/lib/query-client";
import type {
ActivityAnalyticsDto,
AdminShopperEngagementSummaryDto,
AdminAnalyticsSummaryDto,
AdminQueryAnalyticsDto,
DiscountAnalyticsDto,
FunnelAnalyticsDto,
PaymentAnalyticsDto,
TopCategoryDto,
TopProductDto,
TopVendorDto,
UserAnalyticsDto,
} from "@/api/dto/admin-analytics";
import type {
VendorAnalyticsSummaryDto,
VendorProductPerformancePageDto,
VendorQueryAnalyticsDto,
} from "@/api/dto/vendor-analytics";

export const adminAnalyticsService = {
  summary(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<AdminAnalyticsSummaryDto>("/admin/analytics/summary", { params });
  },
  topProducts(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<TopProductDto[]>("/admin/analytics/top-products", { params });
  },
  topVendors(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<TopVendorDto[]>("/admin/analytics/top-vendors", { params });
  },
  topCategories(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<TopCategoryDto[]>("/admin/analytics/top-categories", { params });
  },
  payments(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<PaymentAnalyticsDto>("/admin/analytics/payments", { params });
  },
  discounts(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<DiscountAnalyticsDto>("/admin/analytics/discounts", { params });
  },
  funnel(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<FunnelAnalyticsDto>("/admin/analytics/funnel", { params });
  },
  activity(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<ActivityAnalyticsDto>("/admin/analytics/activity", { params });
  },
  shopperEngagement(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<AdminShopperEngagementSummaryDto>("/admin/analytics/shopper-engagement", { params });
  },
  userAcquisition(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<UserAnalyticsDto>("/admin/analytics/user-acquisition", { params });
  },
};

export const vendorAnalyticsService = {
  summary(params?: VendorQueryAnalyticsDto) {
    return vendorApi.get<VendorAnalyticsSummaryDto>("/vendors/analytics", { params });
  },
  products(params?: VendorQueryAnalyticsDto & { page?: number; limit?: number }) {
    return vendorApi.get<VendorProductPerformancePageDto>("/vendors/analytics/products", { params });
  },
};

export type RecommendationSurface =
  | "HOME_FOR_YOU"
  | "HOME_GOOD_PLACE_TO_START"
  | "HOME_RECENTLY_VIEWED"
  | "HOME_MEET_VENDORS"
  | "HOME_FOLLOWING"
  | "PRODUCT_RELATED"
  | "CATEGORY_POPULAR"
  | "CATEGORY_BROWSE"
  | "DISCOVERY";

export type RecommendationEventType = "IMPRESSION" | "CLICK" | "DISMISS" | "CATEGORY_VIEW";

export interface RecommendationAttribution {
  requestId: string;
  surface: RecommendationSurface;
  rankerVersion: string;
  position: number;
  sessionId: string;
}

interface RecommendationEventPayload extends RecommendationAttribution {
  id: string;
  eventType: RecommendationEventType;
  productId?: string;
  vendorId?: string;
  categoryId?: string;
}

interface QueuedRecommendationImpression {
  payload: RecommendationEventPayload;
  authenticated: boolean;
  dedupeKey: string;
  resolve: (value: { accepted: boolean }) => void;
  reject: (error: unknown) => void;
}

const queuedRecommendationImpressions: QueuedRecommendationImpression[] = [];
const recommendationImpressionKeys = new Set<string>();
const IMPRESSION_BATCH_WINDOW_MS = 3_000;
const IMPRESSION_BATCH_MAX_WAIT_MS = 7_000;
const IMPRESSION_BATCH_THRESHOLD = 100;
const MAX_TRACKED_IMPRESSIONS = 5_000;
let recommendationImpressionTimer: ReturnType<typeof setTimeout> | undefined;
let recommendationImpressionFirstQueuedAt: number | undefined;

// Production-grade lifecycle listener: flush remaining queued telemetry on page exit or visibility hidden
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (queuedRecommendationImpressions.length > 0) {
      void flushRecommendationImpressions();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && queuedRecommendationImpressions.length > 0) {
      void flushRecommendationImpressions();
    }
  });
}

function scheduleRecommendationImpressionFlush() {
  if (recommendationImpressionTimer) clearTimeout(recommendationImpressionTimer);
  if (recommendationImpressionFirstQueuedAt === undefined) {
    recommendationImpressionFirstQueuedAt = Date.now();
  }
  const elapsed = Date.now() - recommendationImpressionFirstQueuedAt;
  const delay = queuedRecommendationImpressions.length >= IMPRESSION_BATCH_THRESHOLD
    ? 0
    : Math.min(IMPRESSION_BATCH_WINDOW_MS, Math.max(0, IMPRESSION_BATCH_MAX_WAIT_MS - elapsed));
  recommendationImpressionTimer = setTimeout(() => {
    recommendationImpressionTimer = undefined;
    recommendationImpressionFirstQueuedAt = undefined;
    void flushRecommendationImpressions();
  }, delay);
}

async function flushRecommendationImpressions() {
  const pending = queuedRecommendationImpressions.splice(0);
  if (pending.length === 0) return;

  const anyAuthenticated = pending.some((item) => item.authenticated);
  const client = anyAuthenticated ? userApi : publicApi;
  const endpoint = "/analytics/events";
  const chunks: QueuedRecommendationImpression[][] = [];
  for (let index = 0; index < pending.length; index += 100) {
    chunks.push(pending.slice(index, index + 100));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const response = await client.post<{ accepted: boolean }>(endpoint, {
          events: chunk.map(({ payload }) => payload),
        });
        for (const item of chunk) item.resolve(response.data);
      } catch (error) {
        for (const item of chunk) {
          recommendationImpressionKeys.delete(item.dedupeKey);
          item.reject(error);
        }
      }
    }),
  );

  if (queuedRecommendationImpressions.length > 0) {
    scheduleRecommendationImpressionFlush();
  }
}

/**
 * Marks every personalised recommendation shelf stale after a behavioural
 * signal has been durably accepted by the API. Shelves refetch the next time
 * they are shown (or the tab is refocused after they went stale); a shelf that
 * is on screen right now is NOT refetched.
 *
 * Why not refetch the visible ones at once: the API rebuilds a shopper's feed
 * a few seconds after their signals (one rebuild per burst, in the worker), so
 * an immediate refetch only receives the old feed again, and every signal
 * would send a duplicate batch of shelf requests.
 * Product-related lists are left alone.
 */
export function refreshPersonalizedRecommendations(): void {
  if (typeof window === "undefined") return;
  void getQueryClient().invalidateQueries(
    {
      predicate: ({ queryKey }) =>
        queryKey[0] === "recommendations" &&
        queryKey[1] !== "related",
      refetchType: "none",
    },
    { cancelRefetch: false },
  );
}

export const analyticsEventService = {
  trackStoreView(
    vendorId: string,
    sessionId: string,
    visitorId: string,
    authenticated: boolean = false,
  ) {
    const id = createRecommendationRequestId();
    if (!id) return Promise.resolve({ accepted: false });
    const client = authenticated ? userApi : publicApi;
    return client.post<{ accepted: boolean }>("/analytics/events", {
      id,
      event: "store_view",
      vendorId,
      sessionId,
      visitorId,
    }).then((result) => {
      refreshPersonalizedRecommendations();
      return result;
    });
  },
  trackProductView(
    productId: string,
    eventId: string,
    sessionId: string,
    authenticated: boolean = false,
    visitorId?: string,
  ) {
    const client = authenticated ? userApi : publicApi;
    return client.post<{ accepted: true }>("/analytics/events", {
      event: "product_view",
      id: eventId,
      productId,
      sessionId,
      visitorId,
    }).then((result) => {
      refreshPersonalizedRecommendations();
      return result;
    });
  },
  trackSearch(
    query: string,
    resultsCount: number,
    sessionId: string,
    authenticated: boolean = false,
    visitorId?: string,
  ) {
    const client = authenticated ? userApi : publicApi;
    return client.post<{ accepted: true }>("/analytics/events", {
      event: "search",
      query,
      resultsCount,
      sessionId,
      visitorId,
    }).then((result) => {
      refreshPersonalizedRecommendations();
      return result;
    });
  },
  trackRecommendation(
    attribution: RecommendationAttribution,
    eventType: RecommendationEventType,
    item: { productId?: string; vendorId?: string; categoryId?: string },
    authenticated: boolean,
  ) {
    const entity = item.productId
      ? `product:${item.productId}`
      : item.vendorId
        ? `vendor:${item.vendorId}`
        : item.categoryId
          ? `category:${item.categoryId}`
          : "unknown";
    const dedupeKey = `${attribution.sessionId}:${attribution.surface}:${entity}`;
    if (eventType === "IMPRESSION" && recommendationImpressionKeys.has(dedupeKey)) {
      return Promise.resolve({ accepted: true });
    }

    const id = createRecommendationRequestId();
    if (!id) return Promise.resolve({ accepted: false });
    const payload: RecommendationEventPayload = {
      id,
      eventType,
      ...attribution,
      ...item,
    };

    if (eventType === "IMPRESSION") {
      return new Promise<{ accepted: boolean }>((resolve, reject) => {
        recommendationImpressionKeys.add(dedupeKey);
        if (recommendationImpressionKeys.size > MAX_TRACKED_IMPRESSIONS) {
          const oldestKey = recommendationImpressionKeys.values().next().value;
          if (oldestKey) recommendationImpressionKeys.delete(oldestKey);
        }
        queuedRecommendationImpressions.push({ payload, authenticated, dedupeKey, resolve, reject });
        scheduleRecommendationImpressionFlush();
      });
    }

    const client = authenticated ? userApi : publicApi;
    const endpoint = "/analytics/events";
    const request = client.post<{ accepted: boolean }>(endpoint, payload);
    // Every non-impression signal (dismiss, category view, store click)
    // changes what the shopper should see next, so shelves refresh after it.
    //
    // A PRODUCT click is the exception: it always navigates to the product
    // page, whose product_view event refreshes the shelves once the view is
    // durably recorded. Refreshing here too would re-fetch four shelves on the
    // page being left, in parallel with the navigation.
    if (eventType === "CLICK" && item.productId) return request;

    return request.then((result) => {
      refreshPersonalizedRecommendations();
      return result;
    });
  },
};
