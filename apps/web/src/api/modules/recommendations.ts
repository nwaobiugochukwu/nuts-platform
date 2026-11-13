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
    const path = authenticated ? "/recommendations/for-you" : "/recommendations/for-you/session";
    return client.get<ProductCardDto[]>(path, {
      params: { sessionId, ...(visitorId ? { visitorId } : {}) },
      signal,
    });
  },
  marketplaceMix(sessionId: string, authenticated: boolean, visitorId?: string, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    const path = authenticated ? "/recommendations/marketplace-mix" : "/recommendations/marketplace-mix/session";
    return client.get<MarketplaceMixResponseDto>(path, {
      params: { sessionId, ...(visitorId ? { visitorId } : {}) },
      signal,
    });
  },
  searchDiscover(sessionId: string, authenticated: boolean, visitorId?: string, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    const path = authenticated ? "/recommendations/search-discover" : "/recommendations/search-discover/session";
    return client.get<SearchDiscoveryResponseDto>(path, {
      params: { sessionId, ...(visitorId ? { visitorId } : {}) },
      signal,
    });
  },
  recentlyViewed(sessionId: string, authenticated: boolean, visitorId?: string, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    const path = authenticated ? "/recommendations/recently-viewed" : "/recommendations/recently-viewed/session";
    return client.get<ProductCardDto[]>(path, { params: { sessionId, visitorId }, signal });
  },
  claimRecentlyViewed(visitorId: string) {
    return userApi.post<{ claimed: number }>("/recommendations/recently-viewed/claim", { visitorId });
  },
  following(signal?: AbortSignal) {
    return userApi.get<ProductCardDto[]>("/recommendations/following", { signal });
  },
  stores(sessionId: string, authenticated: boolean, visitorId?: string, signal?: AbortSignal) {
    const client = authenticated ? userApi : publicApi;
    const path = authenticated ? "/recommendations/stores" : "/recommendations/stores/session";
    return client.get<FeaturedVendorDto[]>(path, {
      params: { sessionId, visitorId },
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
