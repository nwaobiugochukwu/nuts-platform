import type { VariantOption } from "../core/types";

// ── Variants ─────────────────────────────────────────────────────────────────

export interface PublicVariantSummaryDto {
  id: string;
  name: string;
  options: VariantOption[];
  price?: number;
  stock: number;
  inStock: boolean;
  stockStatus: string;
  images: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VendorVariantResponseDto {
  id: string;
  options: VariantOption[];
  stock: number;
  inStock: boolean;
  stockStatus: string;
  images: string[];
  product?: {
    id: string;
    name: string;
    slug: string;
    imageUrl?: string | null;
  };
  isActive: boolean;
  isDeleted: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AdminVariantResponseDto = VendorVariantResponseDto;
