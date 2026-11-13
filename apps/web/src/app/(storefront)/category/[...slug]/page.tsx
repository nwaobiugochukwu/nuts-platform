import {
serverGetCategories,
serverGetCategoryByPath,
serverGetProductBySlug,
serverGetProductReviews,
serverGetProducts,
  serverGetCategoryPreviews,
  serverGetTrendingProducts,
} from "@/api/server";
import { HierarchicalCategoryView } from "@/component/domain/category/HierarchicalCategoryView";
import { findCategoryNode,resolveCategoryPath } from "@/lib/category-tree";
import { Metadata } from "next";
import type { ProductCardDto } from "@/api/dto/product";
import type { PaginationMeta, CursorPaginationMeta } from "@/api/core/types";

interface CatchAllCategoryPageProps {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<{
    search?: string;
    sort?: string;
    minPrice?: string;
    maxPrice?: string;
    inStock?: string;
  }>;
}

export async function generateMetadata({
  params,
}: CatchAllCategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const slugs = Array.isArray(slug) ? slug : [slug];
  const categories = await serverGetCategories();
  const traversal = resolveCategoryPath(categories, slugs);

  if (traversal.matchedNode) {
    return {
      title: `${traversal.matchedNode.name} | NUTS-P Marketplace`,
      description:
        traversal.matchedNode.description ||
        `Shop authentic items in ${traversal.matchedNode.name} on NUTS-P.`,
    };
  }

  if (slugs.length > 0) {
    const lastSlug = slugs[slugs.length - 1];
    if (lastSlug) {
      const product = await serverGetProductBySlug(lastSlug);
      if (product) {
        return {
          title: `${product.name} | NUTS-P Marketplace`,
          description:
            product.description ||
            `Buy ${product.name} directly from verified vendors on NUTS-P.`,
        };
      }
    }
  }

  return {
    title: "Category | NUTS-P Marketplace",
    description: "Explore curated collections and independent vendors on NUTS-P.",
  };
}

export default async function CatchAllCategoryPage({
  params,
  searchParams,
}: CatchAllCategoryPageProps) {
  const [{ slug }, sParams] = await Promise.all([params, searchParams]);
  const slugs = Array.isArray(slug) ? slug : [slug];

  const categories = await serverGetCategories();
  const traversal = resolveCategoryPath(categories, slugs);

  let initialProduct = null;
  let initialTopPicks: ProductCardDto[] = [];
  let initialCategoryPreviews: Awaited<ReturnType<typeof serverGetCategoryPreviews>> = {};
  let initialReviews: Awaited<ReturnType<typeof serverGetProductReviews>> | null = null;
  let initialProductsResult: { data: ProductCardDto[]; meta: PaginationMeta | CursorPaginationMeta | null } = {
    data: [],
    meta: null,
  };
  let resolvedCategory = traversal.matchedNode;

  // Fallback to serverGetCategoryByPath if not matched in tree
  if (!resolvedCategory && slugs.length > 0) {
    resolvedCategory = await serverGetCategoryByPath(slugs.join("/"));
  }

  // Fallback to searching node in full tree by leaf slug
  if (!resolvedCategory && slugs.length > 0) {
    const lastSlug = slugs[slugs.length - 1];
    if (lastSlug) {
      resolvedCategory = findCategoryNode(lastSlug, categories);
      if (!resolvedCategory) {
        resolvedCategory = await serverGetCategoryByPath(lastSlug);
      }
    }
  }

  // Check if trailing segment is a product
  if (traversal.remainingSlugs.length === 1) {
    const trailingSlug = traversal.remainingSlugs[0];
    if (trailingSlug) {
      initialProduct = await serverGetProductBySlug(trailingSlug);
    }
  } else if (!resolvedCategory && slugs.length > 0) {
    const lastSlug = slugs[slugs.length - 1];
    if (lastSlug) {
      initialProduct = await serverGetProductBySlug(lastSlug);
    }
  }

  if (initialProduct?.id) {
    initialReviews = await serverGetProductReviews(initialProduct.id);
  }

  // Root categories show sales-ranked Top Picks and preload one bounded page
  // for every direct child. Deeper category routes show their own paginated grid.
  if (!initialProduct && resolvedCategory?.id) {
    const isRootCategory = resolvedCategory.isRoot || !resolvedCategory.parentId;
    if (isRootCategory) {
      [initialTopPicks, initialCategoryPreviews] = await Promise.all([
        serverGetTrendingProducts({ categoryId: resolvedCategory.id, limit: 12, days: 30 }),
        serverGetCategoryPreviews(resolvedCategory.id, 12),
      ]);
    } else {
      initialProductsResult = await serverGetProducts({
        categoryId: resolvedCategory.id,
        category: resolvedCategory.slug,
        page: 1,
        limit: 24,
        search: sParams.search,
        sort: sParams.sort || "newest",
        minPrice: sParams.minPrice,
        maxPrice: sParams.maxPrice,
        inStock: sParams.inStock,
      });
    }
  }

  return (
    <HierarchicalCategoryView
      key={slugs.join("/")}
      slugs={slugs}
      initialCategories={categories}
      initialCategoryNode={resolvedCategory}
      initialProducts={initialProductsResult.data}
      initialProductMeta={initialProductsResult.meta}
      initialTopPicks={initialTopPicks}
      initialCategoryPreviews={initialCategoryPreviews}
      initialProduct={initialProduct}
      initialReviews={initialReviews}
      initialSearchParams={{
        search: sParams.search || "",
        sort: sParams.sort || "newest",
        minPrice: sParams.minPrice || "",
        maxPrice: sParams.maxPrice || "",
        inStock: sParams.inStock === "true",
      }}
    />
  );
}
