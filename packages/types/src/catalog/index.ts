export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  imageUrl?: string | null;
  parentId?: string | null;
  path?: string | null;
  sortOrder?: number;
  children?: CategoryNode[];
}

export interface CreatorStore {
  id: string;
  storeName: string;
  storeSlug: string;
  storeLogoUrl?: string | null;
  storeBannerUrl?: string | null;
  storeDescription?: string | null;
  isVerified?: boolean;
}

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  price: number;
  discountPrice?: number | null;
  thumbnail?: string | null;
  stockStatus: StockStatus;
  creator?: CreatorStore;
}

export interface ProductVariantDto {
  id: string;
  optionsKey: string;
  options: Record<string, string>;
  stock: number;
  images: string[];
  price?: number | null;
  sku?: string | null;
}
