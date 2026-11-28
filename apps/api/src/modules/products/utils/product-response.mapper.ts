import { Prisma } from '@prisma/client';

import {
  resolveCategoryHierarchy,
  type CategoryLookupMap,
  type ProductWithCategory,
  type PublicProductWithCategory,
  type VendorProductWithCategory,
} from './product-includes.util';

import { getStockStatus } from '@api/common/utils/stock-status.util';
import { computeVariantCombinations } from '@api/common/utils/variant-combinations.util';
import { normalizeOptions } from '@api/common/utils/variant-options.validator';

import { AdminProductResponseDto } from '../dto/admin-product-response.dto';
import { ProductCardDto } from '../dto/product-card.dto';
import { ProductResponseDto } from '../dto/product-response.dto';
import { PublicProductResponseDto } from '../dto/public-product-response.dto';
import { VendorProductResponseDto } from '../dto/vendor-product-response.dto';

import type { VariantSummaryDto } from '@api/modules/products/dto/variant-response.dto';

export function normalizeImageUrls(
  imageUrls?: string[],
  imageUrl?: string,
): string[] {
  const urls = imageUrls?.length ? imageUrls : imageUrl ? [imageUrl] : [];

  return [
    ...new Set(
      urls
        .map((url) => url?.trim())
        .filter((url): url is string => Boolean(url)),
    ),
  ].slice(0, 6);
}

/**
 * Normalizes search input.
 */
export function normalizeSearch(search?: string): string | undefined {
  const normalized = search?.trim();

  return normalized || undefined;
}

/* ==========================================================================
 * RESPONSE MAPPERS
 * ======================================================================== */

/**
 * Calculates total available stock.
 *
 * Product-level stock is authoritative for normal products.
 * Variant stock is authoritative for variant products.
 */
export function computeTotalStock(
  hasVariants: boolean,
  stock: number,
  variants: Array<{
    stock: number;
  }>,
): number {
  if (!hasVariants) {
    return stock;
  }

  return variants.reduce((total, variant) => total + variant.stock, 0);
}

/**
 * Maps the internal product representation to the legacy/full response DTO.
 */
export function toResponse(product: ProductWithCategory): ProductResponseDto {
  const totalStock = computeTotalStock(
    product.hasVariants,
    product.stock,
    product.variants,
  );

  const { inStock, stockStatus } = getStockStatus(
    totalStock,
    product.isActive && !product.isDeleted,
  );

  const images = product.images.map((image) => ({
    id: image.id,
    url: image.url,

    /*
     * IMPORTANT:
     *
     * If ProductImage has an actual `publicId` column, add it to the
     * Prisma select and return it here.
     *
     * Do not pretend the URL is the Cloudinary/public ID.
     */
    publicId: image.url,

    position: image.position,
    isCover: image.position === 0,
  }));

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    sku: product.sku,

    hasVariants: product.hasVariants,

    price: Number(product.price),

    stock: totalStock,
    inStock,
    stockStatus,

    variants: product.variants.map((variant) => toVariantSummaryDto(variant)),

    variantCombinations:
      product.variants.length > 0
        ? computeVariantCombinations(product.variants)
        : undefined,

    vendor: {
      id: product.vendor.id,
      storeName: product.vendor.storeName,
      storeSlug: product.vendor.storeSlug,
      storeLogoUrl: product.vendor.storeLogoUrl,
    },

    ...resolveCategoryHierarchy(product.category),

    imageUrl: product.images[0]?.url ?? null,

    images,

    isActive: product.isActive,

    createdAt: product.createdAt,

    updatedAt: product.updatedAt,
  };
}

/**
 * Maps lightweight public product card response for catalog grids.
 */
export function toCardResponse(
  product: PublicProductWithCategory,
  categoryMap?: CategoryLookupMap,
): ProductCardDto {
  const totalStock = computeTotalStock(
    product.hasVariants,
    product.stock,
    product.variants,
  );

  const { stockStatus } = getStockStatus(
    totalStock,
    product.isActive && !product.isDeleted,
  );

  const coverImage =
    product.images.find((img) => img.position === 0) || product.images[0];

  const hierarchy = resolveCategoryHierarchy(product.category, categoryMap);

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    hasVariants: product.hasVariants,
    price: Number(product.price),
    discountPrice: null,
    thumbnail: coverImage?.url ?? null,
    stockStatus,
    categoryId: hierarchy.category?.id || product.categoryId || null,
    category: hierarchy.category?.id ? hierarchy.category : null,
    parentSubcategory: hierarchy.parentSubcategory || null,
    subcategory: hierarchy.subcategory || null,
    vendor: {
      id: product.vendor.id,
      storeName: product.vendor.storeName,
      storeSlug: product.vendor.storeSlug,
      storeLogoUrl: product.vendor.storeLogoUrl ?? undefined,
      isVerified: product.vendor.isVerified,
    },
  };
}

/**
 * Maps public product response.
 */
export function toPublicResponse(
  product: PublicProductWithCategory,
  includeCombinations = true,
  categoryMap?: CategoryLookupMap,
): PublicProductResponseDto {
  const totalStock = computeTotalStock(
    product.hasVariants,
    product.stock,
    product.variants,
  );

  const { inStock, stockStatus } = getStockStatus(
    totalStock,
    product.isActive && !product.isDeleted,
  );

  const images = product.images.map((image) => ({
    url: image.url,

    /*
     * Replace this with the actual storage publicId if your schema has
     * one. Never use URL as a fake publicId long-term.
     */
    publicId: image.url,

    isCover: image.position === 0,
  }));

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    sku: product.sku,

    hasVariants: product.hasVariants,

    price: Number(product.price),

    stock: totalStock,
    discountPrice: undefined,
    salePercentage: 0,

    inStock,
    stockStatus,

    variants: product.variants.map((variant) => toVariantSummaryDto(variant)),

    variantCombinations:
      includeCombinations && product.variants.length > 0
        ? computeVariantCombinations(product.variants)
        : undefined,

    vendor: {
      id: product.vendor.id,
      storeName: product.vendor.storeName,
      storeSlug: product.vendor.storeSlug,
      storeLogoUrl: product.vendor.storeLogoUrl,
      storeDescription: product.vendor.storeDescription ?? undefined,
    },

    ...resolveCategoryHierarchy(product.category, categoryMap),

    imageUrl: product.images[0]?.url ?? null,

    images,

    isActive: product.isActive,

    createdAt: product.createdAt,

    updatedAt: product.updatedAt,
  };
}

/**
 * Maps vendor product response.
 */
export function toVendorResponse(
  product: VendorProductWithCategory,
  categoryMap?: CategoryLookupMap,
): VendorProductResponseDto {
  const totalStock = computeTotalStock(
    product.hasVariants,
    product.stock,
    product.variants,
  );

  const { inStock, stockStatus } = getStockStatus(
    totalStock,
    product.isActive && !product.isDeleted,
  );

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    sku: product.sku,

    hasVariants: product.hasVariants,

    price: Number(product.price),

    stock: totalStock,
    inStock,
    stockStatus,

    variants: product.variants.map((variant) => toVariantSummaryDto(variant)),

    variantCombinations:
      product.variants.length > 0
        ? computeVariantCombinations(product.variants)
        : undefined,

    ...resolveCategoryHierarchy(product.category, categoryMap),

    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      publicId: image.url,
      position: image.position,
      isCover: image.position === 0,
    })),

    isActive: product.isActive,

    isDeleted: product.isDeleted,

    deletedAt: product.deletedAt ?? null,

    createdAt: product.createdAt,

    updatedAt: product.updatedAt,
  };
}

/**
 * Maps admin product response.
 */
export function toAdminResponse(
  product: ProductWithCategory,
  categoryMap?: CategoryLookupMap,
): AdminProductResponseDto {
  const totalStock = computeTotalStock(
    product.hasVariants,
    product.stock,
    product.variants,
  );

  const { inStock, stockStatus } = getStockStatus(
    totalStock,
    product.isActive && !product.isDeleted,
  );

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    sku: product.sku,

    hasVariants: product.hasVariants,

    price: Number(product.price),

    stock: totalStock,
    inStock,
    stockStatus,

    variants: product.variants.map((variant) => toVariantSummaryDto(variant)),

    variantCombinations:
      product.variants.length > 0
        ? computeVariantCombinations(product.variants)
        : undefined,

    vendor: {
      id: product.vendor.id,
      storeName: product.vendor.storeName,
      storeSlug: product.vendor.storeSlug,
      storeLogoUrl: product.vendor.storeLogoUrl,
    },

    ...resolveCategoryHierarchy(product.category, categoryMap),

    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      publicId: image.url,
      position: image.position,
      isCover: image.position === 0,
    })),

    isActive: product.isActive,

    isDeleted: product.isDeleted,

    deletedAt: product.deletedAt ?? null,

    createdAt: product.createdAt,

    updatedAt: product.updatedAt,
  };
}

/**
 * Maps a Prisma variant to VariantSummaryDto.
 *
 * Timestamps come directly from Prisma.
 *
 * There is intentionally NO:
 *
 * createdAt: variant.createdAt ?? new Date()
 *
 * because manufacturing timestamps makes the API lie about the database.
 */
export function toVariantSummaryDto(variant: {
  id: string;
  options: Prisma.JsonValue;
  stock: number;
  images: string[];
  isActive: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}): VariantSummaryDto {
  const options = normalizeOptions(variant.options).map(({ name, value }) => ({
    name,
    value,
  }));

  const { inStock, stockStatus } = getStockStatus(
    variant.stock,
    variant.isActive && !variant.isDeleted,
  );

  return {
    id: variant.id,
    options,

    stock: variant.stock,
    inStock,
    stockStatus,

    images: variant.images ?? [],

    isActive: variant.isActive,

    isDeleted: variant.isDeleted,

    createdAt: variant.createdAt,

    updatedAt: variant.updatedAt,
  };
}

/* ==========================================================================
 * SLUGS
 * ======================================================================== */

/**
 * Resolves a normalized unique product slug.
 */
