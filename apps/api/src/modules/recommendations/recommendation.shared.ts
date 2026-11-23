/**
 * Constants, candidate types and pure ranking helpers shared by the
 * recommendation services. Nothing here touches the database.
 */
import { OrderStatus, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

export const PURCHASE_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

export const RECOMMENDATION_LIMIT = 12;
export const PERSONALIZED_RECOMMENDATION_POOL_LIMIT = 24;
export const MARKETPLACE_MIX_VENDOR_LIMIT = 12;
export const MARKETPLACE_MIX_PRODUCT_LIMIT = 12;
export const MARKETPLACE_MIX_MAX_PRODUCTS_PER_VENDOR = 1;
export const MARKETPLACE_MIX_POOL_LIMIT = 160;
export const SEARCH_DISCOVERY_PRODUCT_LIMIT = 8;
export const SEARCH_DISCOVERY_VENDOR_LIMIT = 4;
export const SEARCH_DISCOVERY_POOL_LIMIT = 160;
export const HISTORY_DAYS = 180;
export const EXPOSURE_SUPPRESSION_DAYS = 14;
export const RECENT_IMPRESSION_SCORE_PENALTY = 3.5;
export const AVAILABLE_PRODUCT: Prisma.ProductWhereInput = {
  OR: [
    { stock: { gt: 0 } },
    {
      variants: {
        some: { isActive: true, isDeleted: false, stock: { gt: 0 } },
      },
    },
  ],
};

export type CandidateProduct = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  vendorId: string;
  createdAt: Date;
  category: { name: string };
};

export type MarketplaceMixCandidate = {
  id: string;
  categoryId: string;
  vendorId: string;
  createdAt: Date;
};

export type SearchDiscoveryCandidate = Omit<
  MarketplaceMixCandidate,
  'createdAt'
>;

export type MarketplaceMixVendor = {
  id: string;
  storeName: string;
  storeSlug: string;
  storeDescription: string;
  storeLogoUrl: string | null;
  isVerified: boolean;
};

export type ScoredProduct = {
  id: string;
  score: number;
  product: CandidateProduct;
};

export function addWeight(
  target: Map<string, number>,
  id: string,
  amount: number,
) {
  target.set(id, (target.get(id) ?? 0) + amount);
}

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

export function stableUuidCursor(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function searchTokens(queries: string[], minimumTokenLength = 3) {
  const weights = new Map<string, number>();
  for (const [index, query] of queries.entries()) {
    const recencyWeight = Math.pow(0.78, index);
    const tokens = query
      .toLocaleLowerCase()
      .normalize('NFKC')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= minimumTokenLength)
      .slice(0, 5);
    for (const token of new Set(tokens)) {
      addWeight(weights, token, recencyWeight);
    }
  }
  return weights;
}

export function scoreAndDiversify(
  candidates: CandidateProduct[],
  excludedIds: Set<string>,
  categoryWeights: Map<string, number>,
  vendorWeights: Map<string, number>,
  searchWeights: Map<string, number>,
  coPurchaseScores: Map<string, number>,
  limit = RECOMMENDATION_LIMIT,
  recentlyImpressedIds: Set<string> = new Set(),
) {
  const now = Date.now();
  const scored: ScoredProduct[] = candidates
    .filter((product) => !excludedIds.has(product.id))
    .map((product) => {
      const searchableText =
        `${product.name} ${product.description ?? ''} ${product.category.name}`
          .toLocaleLowerCase()
          .normalize('NFKC');
      const searchableTokens = new Set(
        searchableText.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
      );
      let searchScore = 0;
      for (const [token, weight] of searchWeights) {
        if (searchableTokens.has(token)) searchScore += weight * 2.5;
      }
      const ageDays = Math.max(
        0,
        (now - product.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      const recencyScore = Math.max(0, 1 - ageDays / 120);
      const score =
        (coPurchaseScores.get(product.id) ?? 0) +
        Math.min(15, (categoryWeights.get(product.categoryId) ?? 0) * 2.2) +
        Math.min(6, (vendorWeights.get(product.vendorId) ?? 0) * 0.55) +
        searchScore +
        recencyScore -
        (recentlyImpressedIds.has(product.id)
          ? RECENT_IMPRESSION_SCORE_PENALTY
          : 0);
      return { id: product.id, score, product };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.product.createdAt.getTime() - a.product.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );

  // Limit repeated stores and categories so one strong signal cannot dominate
  // the whole shelf. If the catalog is too small, fill remaining slots after.
  const selected: ScoredProduct[] = [];
  const selectedIds = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const vendorCounts = new Map<string, number>();

  for (const product of scored) {
    if (
      (categoryCounts.get(product.product.categoryId) ?? 0) >= 4 ||
      (vendorCounts.get(product.product.vendorId) ?? 0) >= 3
    ) {
      continue;
    }
    selected.push(product);
    selectedIds.add(product.id);
    categoryCounts.set(
      product.product.categoryId,
      (categoryCounts.get(product.product.categoryId) ?? 0) + 1,
    );
    vendorCounts.set(
      product.product.vendorId,
      (vendorCounts.get(product.product.vendorId) ?? 0) + 1,
    );
    if (selected.length === limit) break;
  }

  if (selected.length < limit) {
    for (const product of scored) {
      if (selectedIds.has(product.id)) continue;
      selected.push(product);
      if (selected.length === limit) break;
    }
  }
  return selected.map(({ id }) => id);
}

export function explainRecommendation(
  candidate: CandidateProduct,
  coPurchaseScores: Map<string, number>,
  followedVendorIds: Set<string>,
  categoryWeights: Map<string, number>,
  vendorWeights: Map<string, number>,
  searchWeights: Map<string, number>,
): string {
  if ((coPurchaseScores.get(candidate.id) ?? 0) > 0) {
    return 'Often bought alongside products you purchased';
  }
  if (followedVendorIds.has(candidate.vendorId))
    return 'From a store you follow';
  const tokens = new Set(
    `${candidate.name} ${candidate.description ?? ''} ${candidate.category.name}`
      .toLocaleLowerCase()
      .normalize('NFKC')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
  if ([...searchWeights.keys()].some((token) => tokens.has(token))) {
    return 'Matches your recent searches';
  }
  if (categoryWeights.has(candidate.categoryId)) {
    return `Based on your interest in ${candidate.category.name}`;
  }
  if (vendorWeights.has(candidate.vendorId))
    return 'From a store you have explored';
  return 'Based on your shopping activity';
}
