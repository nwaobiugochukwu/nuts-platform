import { adminApi, publicApi, userApi, vendorApi } from "@/api/core/client";
import { createRecommendationRequestId } from "@/lib/recommendation-session";
import { getQueryClient } from "@/lib/query-client";
import type {
ActivityAnalyticsDto,
AdminMarketplaceAnalyticsSummaryDto,
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
  marketplacePerformance(params?: AdminQueryAnalyticsDto) {
    return adminApi.get<AdminMarketplaceAnalyticsSummaryDto>("/admin/analytics/marketplace-performance", { params });
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
  | "HOME_MARKETPLACE_MIX"
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
const IMPRESSION_BATCH_WINDOW_MS = 750;
const IMPRESSION_BATCH_MAX_WAIT_MS = 3_000;
const MAX_TRACKED_IMPRESSIONS = 5_000;
let recommendationImpressionTimer: ReturnType<typeof setTimeout> | undefined;
let recommendationImpressionFirstQueuedAt: number | undefined;

function scheduleRecommendationImpressionFlush() {
  if (recommendationImpressionTimer) clearTimeout(recommendationImpressionTimer);
  if (recommendationImpressionFirstQueuedAt === undefined) {
    recommendationImpressionFirstQueuedAt = Date.now();
  }
  const elapsed = Date.now() - recommendationImpressionFirstQueuedAt;
  const delay = queuedRecommendationImpressions.length >= 100
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

  const groups = [true, false].map((authenticated) => ({
    authenticated,
    events: pending.filter((item) => item.authenticated === authenticated),
  })).filter(({ events }) => events.length > 0);

  await Promise.all(groups.flatMap(({ authenticated, events }) => {
    const client = authenticated ? userApi : publicApi;
    const endpoint = authenticated
      ? "/analytics/events/recommendations/authenticated/batch"
      : "/analytics/events/recommendations/batch";
    const chunks: QueuedRecommendationImpression[][] = [];
    for (let index = 0; index < events.length; index += 100) {
      chunks.push(events.slice(index, index + 100));
    }

    return chunks.map(async (chunk) => {
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
    });
  }));

  if (queuedRecommendationImpressions.length > 0) {
    scheduleRecommendationImpressionFlush();
  }
}

export const analyticsEventService = {
  trackStoreView(
    vendorId: string,
    sessionId: string,
    visitorId: string,
    authenticated: boolean,
  ) {
    const id = createRecommendationRequestId();
    if (!id) return Promise.resolve({ accepted: false });
    const client = authenticated ? userApi : publicApi;
    const endpoint = authenticated
      ? "/analytics/events/store-view/authenticated"
      : "/analytics/events/store-view/guest";
    return client.post<{ accepted: boolean }>(endpoint, {
      id,
      vendorId,
      sessionId,
      visitorId,
    });
  },
  trackProductView(productId: string, eventId: string, sessionId: string, authenticated: boolean, visitorId?: string) {
    const client = authenticated ? userApi : publicApi;
    const endpoint = authenticated ? "/analytics/events" : "/analytics/events/guest";
    return client.post<{ accepted: true }>(endpoint, {
      event: "product_view",
      id: eventId,
      productId,
      sessionId,
      visitorId,
    });
  },
  trackSearch(query: string, resultsCount: number, sessionId: string, authenticated: boolean) {
    const client = authenticated ? userApi : publicApi;
    const endpoint = authenticated ? "/analytics/events" : "/analytics/events/guest";
    return client.post<{ accepted: true }>(endpoint, {
      event: "search",
      query,
      resultsCount,
      sessionId,
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
    const dedupeKey = `${attribution.surface}:${attribution.requestId}:${entity}`;
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
    const endpoint = authenticated
      ? "/analytics/events/recommendations/authenticated"
      : "/analytics/events/recommendations";
    const request = client.post<{ accepted: boolean }>(endpoint, payload);
    // Product clicks are followed by a product-view event, which refreshes the
    // shelves after durable history is written. Refresh here only for store
    // clicks that don't navigate to a product, and for category browsing.
    const shouldRefreshForSignal = eventType === "CATEGORY_VIEW" ||
      (eventType === "CLICK" && Boolean(item.vendorId) && !item.productId);
    if (!shouldRefreshForSignal) return request;

    return request.then((result) => {
      if (typeof window !== "undefined") {
        const queryClient = getQueryClient();
        const signalShelves = eventType === "CATEGORY_VIEW"
          ? new Set(["for-you", "stores"])
          : new Set(["for-you"]);
        void queryClient.invalidateQueries({
          predicate: ({ queryKey }) =>
            queryKey[0] === "recommendations" &&
            typeof queryKey[1] === "string" &&
            signalShelves.has(queryKey[1]) &&
            queryKey[3] === attribution.sessionId,
          refetchType: "all",
        });
      }
      return result;
    });
  },
};
