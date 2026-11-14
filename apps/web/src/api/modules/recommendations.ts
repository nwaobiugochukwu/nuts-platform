import { publicApi, userApi } from "@/api/core/client";
import type { ProductCardDto } from "@/api/dto/product";
import type {
  MarketplaceMixResponseDto,
  SearchDiscoveryResponseDto,
} from "@/api/dto/recommendations";
import type { FeaturedVendorDto } from "@/api/dto/vendor";

export const recommendationService = {
  discover(signal?: AbortSignal) {
    return publicApi.get<ProductCardDto[]>("/recommendations/discover", { signal });
  },
  forYou(sessionId: string, authenticated: boolean, visitorId?: string, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    return client.get<ProductCardDto[]>("/recommendations/for-you", {
      params: { sessionId, ...(visitorId ? { visitorId } : {}) },
      signal,
    });
  },
  marketplaceMix(sessionId: string, authenticated: boolean, visitorId?: string, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    return client.get<MarketplaceMixResponseDto>("/recommendations/marketplace-mix", {
      params: { sessionId, ...(visitorId ? { visitorId } : {}) },
      signal,
    });
  },
  searchDiscover(sessionId: string, authenticated: boolean, visitorId?: string, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    return client.get<SearchDiscoveryResponseDto>("/recommendations/search-discover", {
      params: { sessionId, ...(visitorId ? { visitorId } : {}) },
      signal,
    });
  },
  recentlyViewed(sessionId: string, authenticated: boolean, visitorId?: string, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    return client.get<ProductCardDto[]>("/recommendations/recently-viewed", {
      params: { sessionId, ...(visitorId ? { visitorId } : {}) },
      signal,
    });
  },
  claimRecentlyViewed(visitorId: string) {
    return userApi.post<{ claimed: number }>("/recommendations/recently-viewed/claim", { visitorId });
  },
  following(signal?: AbortSignal) {
    return userApi.get<ProductCardDto[]>("/recommendations/following", { signal });
  },
  stores(sessionId: string, authenticated: boolean, visitorId?: string, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    return client.get<FeaturedVendorDto[]>("/recommendations/stores", {
      params: { sessionId, ...(visitorId ? { visitorId } : {}) },
      signal,
    });
  },
  related(productId: string, signal?: AbortSignal) {
    return publicApi.get<ProductCardDto[]>(
      `/recommendations/related/${encodeURIComponent(productId)}`,
      { signal },
    );
  },
};
