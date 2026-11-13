import type { WalletTransactionType } from "../core/types";
import type { ProductCardDto } from "./product";

export interface WalletTransactionResponseDto {
  id: string;
  amount: number;
  type: WalletTransactionType;
  reason: string;
  referenceId: string | null;
  createdAt: Date;
}

export interface VendorWalletResponseDto {
  id: string;
  balance: number;
  pendingBalance: number;
  lifetimeEarnings: number;
  createdAt: Date;
  updatedAt: Date;
  transactions: WalletTransactionResponseDto[];
}

// ── Vendors ─────────────────────────────────────────────────────────────────

export interface VendorResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  storeName: string;
  storeSlug: string;
  storeLogo?: string | null;
  storeDescription: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  storeLogoUrl: string | null;
  storeLogoAltText: string | null;
  phone: string | null;
  isVerified: boolean;
  isActive: boolean;
  isApproved: boolean;
  createdAt: Date;
  updatedAt?: Date;
  categories?: Array<{ id: string; name: string; slug: string }>;
}

export type VendorProfileDto = VendorResponseDto;

export interface VendorStoreDto {
  id: string;
  storeName: string;
  storeSlug: string;
  storeDescription: string | null;
  storeLogoUrl: string | null;
  storeLogoAltText: string | null;
  isVerified: boolean;
  categories?: Array<{ id: string; name: string; slug: string }>;
}

export interface FeaturedVendorDto {
  id: string;
  storeName: string;
  storeSlug: string;
  storeDescription: string | null;
  storeLogoUrl: string | null;
  isVerified: boolean;
  createdAt: Date;
  featuredProducts: ProductCardDto[];
}

export interface FollowedVendorDto {
  createdAt: Date;
  vendor: Pick<FeaturedVendorDto, "id" | "storeName" | "storeSlug" | "storeDescription" | "storeLogoUrl" | "isVerified">;
}

export interface FollowedVendorsPageDto {
  data: FollowedVendorDto[];
  meta: FollowedVendorsMetaDto;
}

export interface FollowedVendorsMetaDto {
  followingCount: number;
  matchingCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface VendorFollowerCountDto {
  count: number;
}

export interface VendorLoginResponseDto {
  id: string;
  storeName: string;
  storeSlug: string;
  storeDescription: string;
}

export interface VendorAuthSessionDto {
  vendor: VendorResponseDto;
  accessToken?: string;
}


export interface AdminVendorResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  storeName: string;
  storeSlug: string;
  storeDescription: string;
  businessPhone: string | null;
  businessEmail: string;
  storeLogoUrl: string | null;
  storeLogoAltText: string | null;
  isVerified: boolean;
  isActive: boolean;
  isApproved: boolean;
  deactivatedAt: Date | null;
  deactivatedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
