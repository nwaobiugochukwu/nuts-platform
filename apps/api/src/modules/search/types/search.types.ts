export interface ProductRow {
  id: string;
  name: string;
  sku: string;
  slug?: string;
  price?: number | string;
  imageUrl?: string | null;
  score: number | string;
  total_count: number;
}

export interface VendorRow {
  id: string;
  storeName: string;
  storeSlug?: string;
  storeLogoUrl?: string | null;
  storeDescription: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  score: number | string;
  total_count: number;
}

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  slug: string;
  parentId: string | null;
  parentName: string | null;
  parentSlug: string | null;
  path: string | null;
  score: number | string;
  total_count: number;
}

export interface UserRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  referralCode: string | null;
  score: number | string;
  total_count: number;
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  discountCode: string | null;
  referralCode: string | null;
  shippingAddress: string | null;
  userEmail: string | null;
  score: number | string;
  total_count: number;
}

export interface DiscountCodeRow {
  id: string;
  code: string;
  description: string | null;
  score: number | string;
  total_count: number;
}

export interface ProductSearchIdRow {
  id: string;
  score: number | string;
  total_count: number;
}

export type SearchIndex =
  | 'products'
  | 'vendors'
  | 'categories'
  | 'users'
  | 'orders'
  | 'discount_codes';

export interface SearchResultItem {
  id: string;
  index: SearchIndex;
  type: string;
  title: string;
  subtitle?: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface SearchResponsePayload {
  results: SearchResultItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SearchProductHit {
  type: string;
  title: string;
  description: string | null;
  image: string | null;
  searchKeywords: string[];
  createdAt: Date;
  updatedAt: Date;
  slug: string;
  price: number;
  vendor: {
    slug: string;
    logo: string | null;
    banner: string | null;
    businessName: string;
  };
  category: {
    id: string;
    slug: string;
    name: string;
  };
  subcategory: {
    id: string;
    slug: string;
    name: string;
  } | null;
  section: string | null;
  hasDiscount: boolean;
  discountDetails: {
    type: 'PERCENTAGE' | 'FIXED';
    value: number;
    maxAmount: number | null;
  } | null;
  objectID: string;
}

export interface SearchProductsResponsePayload {
  hits: SearchProductHit[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
