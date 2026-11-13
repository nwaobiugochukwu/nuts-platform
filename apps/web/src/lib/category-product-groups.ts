import type { CategoryResponseDto } from "@/api/dto/category";
import type { ProductCardDto } from "@/api/dto/product";

export interface CategoryProductGroup {
  id: string;
  name: string;
  slug: string;
  products: ProductCardDto[];
}

interface GroupProductsByCategoryOptions {
  products: ProductCardDto[];
  children: CategoryResponseDto[];
  categoryTree: CategoryResponseDto[];
  fallbackCategory?: Pick<CategoryResponseDto, "id" | "name" | "slug"> | null;
}

export function groupProductsByImmediateCategory({
  products,
  children,
  categoryTree,
  fallbackCategory,
}: GroupProductsByCategoryOptions): CategoryProductGroup[] {
  const categoryMap = new Map<
    string,
    { id: string; parentId: string | null }
  >();

  const addCategories = (categories: CategoryResponseDto[]) => {
    for (const category of categories) {
      const categoryRef = { id: category.id, parentId: category.parentId };
      categoryMap.set(category.id, categoryRef);
      categoryMap.set(category.slug, categoryRef);
      const nestedCategories =
        category.children?.length
          ? category.children
          : category.subCategories ?? [];
      addCategories(nestedCategories);
    }
  };
  addCategories(categoryTree);

  const groupMap = new Map<string, CategoryProductGroup>();
  for (const child of children) {
    groupMap.set(child.id, {
      id: child.id,
      name: child.name,
      slug: child.slug || child.id,
      products: [],
    });
  }

  const isInCategoryTree = (targetId: string, categoryId: string): boolean => {
    const visited = new Set<string>();
    let current = categoryMap.get(targetId);

    while (current && !visited.has(current.id)) {
      if (current.id === categoryId) return true;
      visited.add(current.id);
      current = current.parentId ? categoryMap.get(current.parentId) : undefined;
    }

    return false;
  };

  for (const product of products) {
    const categoryIds = [
      product.subcategory?.id,
      product.parentSubcategory?.id,
      product.category?.id,
      product.categoryId,
    ].filter((id): id is string => Boolean(id));

    const matchingChild = children.find((child) =>
      categoryIds.some((categoryId) => isInCategoryTree(categoryId, child.id)),
    );

    if (matchingChild) {
      groupMap.get(matchingChild.id)?.products.push(product);
      continue;
    }

    const fallbackId = fallbackCategory?.id || "collection";
    let fallbackGroup = groupMap.get(fallbackId);
    if (!fallbackGroup) {
      fallbackGroup = {
        id: fallbackId,
        name: fallbackCategory?.name || "All Products",
        slug: fallbackCategory?.slug || "all-products",
        products: [],
      };
      groupMap.set(fallbackId, fallbackGroup);
    }
    fallbackGroup.products.push(product);
  }

  return Array.from(groupMap.values()).filter(
    (group) =>
      group.products.length > 0 ||
      children.some(
        (child) =>
          child.id === group.id &&
          ((child.children?.length ?? 0) > 0 ||
            (child.subCategories?.length ?? 0) > 0),
      ),
  );
}
