import type { ProductCardDto } from "./product";
import type { FeaturedVendorDto } from "./vendor";

export interface MarketplaceMixVendorDto {
  vendor: Pick<
    FeaturedVendorDto,
    "id" | "storeName" | "storeSlug" | "storeDescription" | "storeLogoUrl" | "isVerified"
  >;
  /** The rotating homepage mix returns one available product for each vendor. */
  products: ProductCardDto[];
}

export interface MarketplaceMixResponseDto {
  /** Up to twelve active, distinct vendors. */
  vendors: MarketplaceMixVendorDto[];
}

export type SearchDiscoveryItemDto =
  | {
      type: "product";
      product: ProductCardDto;
      reason: string;
    }
  | {
      type: "vendor";
      vendor: MarketplaceMixVendorDto["vendor"];
      products: ProductCardDto[];
      reason: string;
    };

export interface SearchDiscoveryResponseDto {
  items: SearchDiscoveryItemDto[];
}
