import type { ProductCardDto } from "./product";
import type { FeaturedVendorDto } from "./vendor";

/** The few fields a store card needs. */
export type StoreSummaryDto = Pick<
  FeaturedVendorDto,
  "id" | "storeName" | "storeSlug" | "storeDescription" | "storeLogoUrl" | "isVerified"
>;

/** Why a product is on the "Good place to start" shelf. */
export type GoodPlaceToStartSource = "store_sampler" | "for_you";

export interface GoodPlaceToStartItemDto {
  product: ProductCardDto;
  /** `store_sampler`: part of the daily spread across stores. `for_you`: picked from the shopper's activity. */
  source: GoodPlaceToStartSource;
}

export interface GoodPlaceToStartResponseDto {
  /** Up to twelve purchasable products with an image, at most one per store. */
  items: GoodPlaceToStartItemDto[];
}

export type SearchDiscoveryItemDto =
  | {
      type: "product";
      product: ProductCardDto;
      reason: string;
    }
  | {
      type: "vendor";
      vendor: StoreSummaryDto;
      products: ProductCardDto[];
      reason: string;
    };

export interface SearchDiscoveryResponseDto {
  items: SearchDiscoveryItemDto[];
}
