import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CursorPayload } from '@api/common/utils/cursor-pagination.util';

/* ============================================================================
 * SHARED SELECTS
 * ========================================================================== */

/**
 * Flat category projection avoiding recursive N+1 relation queries.
 * Ancestor hierarchy is resolved in-memory via cached lookup map.
 */
export const categorySelect = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
  path: true,
} as const;

export const categoryHierarchySelect = categorySelect;

export interface CategorySummaryRef {
  id: string;
  name: string;
  slug: string;
}

export type CategoryLookupMap = Map<
  string,
  { id: string; name: string; slug: string; parentId: string | null }
>;

export interface CategoryHierarchyNode {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  parent?: CategoryHierarchyNode | null;
  parentCategory?: CategoryHierarchyNode | null;
}

export function resolveCategoryHierarchy(
  leafCategory: CategoryHierarchyNode | null | undefined,
  lookupMap?: CategoryLookupMap,
): {
  category: CategorySummaryRef;
  parentSubcategory?: CategorySummaryRef;
  subcategory?: CategorySummaryRef;
} {
  if (!leafCategory) {
    return {
      category: { id: '', name: '', slug: '' },
    };
  }

  const chain: CategorySummaryRef[] = [];
  let curr: CategoryHierarchyNode | null | undefined = leafCategory;

  // 1. If leafCategory already contains nested parent relation objects
  if (curr.parent || curr.parentCategory) {
    while (curr) {
      chain.unshift({
        id: curr.id,
        name: curr.name,
        slug: curr.slug,
      });
      curr = curr.parent ?? curr.parentCategory;
    }
  } else if (lookupMap && curr.id) {
    // 2. O(1) in-memory traversal using cached category lookup map (0 SQL queries)
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      chain.unshift({
        id: curr.id,
        name: curr.name,
        slug: curr.slug,
      });
      if (!curr.parentId) break;
      curr = lookupMap.get(curr.parentId);
    }
  } else {
    // 3. Fallback: single leaf category node
    chain.push({
      id: curr.id,
      name: curr.name,
      slug: curr.slug,
    });
  }

  const root = chain[0] || {
    id: leafCategory.id || '',
    name: leafCategory.name || '',
    slug: leafCategory.slug || '',
  };

  const category: CategorySummaryRef = {
    id: root.id,
    name: root.name,
    slug: root.slug,
  };

  const result: {
    category: CategorySummaryRef;
    parentSubcategory?: CategorySummaryRef;
    subcategory?: CategorySummaryRef;
  } = { category };

  if (chain.length === 2) {
    result.subcategory = {
      id: chain[1].id,
      name: chain[1].name,
      slug: chain[1].slug,
    };
  } else if (chain.length >= 3) {
    const parentSub = chain[chain.length - 2];
    const leaf = chain[chain.length - 1];
    result.parentSubcategory = {
      id: parentSub.id,
      name: parentSub.name,
      slug: parentSub.slug,
    };
    result.subcategory = {
      id: leaf.id,
      name: leaf.name,
      slug: leaf.slug,
    };
  }

  return result;
}

/**
 * Variant fields required by product responses.
 *
 * createdAt / updatedAt are intentionally selected because the response DTO
 * exposes them. We never manufacture timestamps with `new Date()`.
 */
export const variantSelect = {
  id: true,
  options: true,
  stock: true,
  images: true,
  isActive: true,
  isDeleted: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Admin variant select.
 *
 * Includes deletion metadata that is useful to administrators.
 */
export const adminVariantSelect = {
  ...variantSelect,
  deletedAt: true,
} as const;

/**
 * Public variant select.
 *
 * This intentionally contains no internal-only deletion timestamp.
 */
export const publicVariantSelect = {
  id: true,
  options: true,
  stock: true,
  images: true,
  isActive: true,
  isDeleted: true,
  createdAt: true,
  updatedAt: true,
} as const;

/* ============================================================================
 * PRISMA PAYLOAD TYPES
 * ========================================================================== */

export type ProductWithCategory = Prisma.ProductGetPayload<{
  include: {
    category: { select: typeof categorySelect };
    images: {
      select: {
        id: true;
        url: true;
        position: true;
      };
    };
    vendor: {
      select: {
        id: true;
        storeName: true;
        storeSlug: true;
        storeLogoUrl: true;
      };
    };
    variants: {
      select: typeof variantSelect;
      where: {
        isDeleted: false;
      };
      orderBy: {
        createdAt: 'asc';
      };
    };
  };
}>;

export type PublicProductWithCategory = Prisma.ProductGetPayload<{
  include: {
    category: { select: typeof categorySelect };
    images: {
      select: {
        id: true;
        url: true;
        position: true;
      };
    };
    vendor: {
      select: {
        id: true;
        storeName: true;
        storeSlug: true;
        storeLogoUrl: true;
        isVerified: true;
      };
    };
    variants: {
      select: typeof publicVariantSelect;
      where: {
        isDeleted: false;
        isActive: true;
      };
      orderBy: {
        createdAt: 'asc';
      };
    };
  };
}> & {
  vendor: {
    storeDescription?: string | null;
  };
};

export type VendorProductWithCategory = Prisma.ProductGetPayload<{
  include: {
    category: { select: typeof categorySelect };
    images: {
      select: {
        id: true;
        url: true;
        position: true;
      };
    };
    vendor: {
      select: {
        id: true;
        storeName: true;
        storeSlug: true;
        storeLogoUrl: true;
      };
    };
    variants: {
      select: typeof publicVariantSelect;
      where: {
        isDeleted: false;
      };
      orderBy: {
        createdAt: 'asc';
      };
    };
  };
}>;

function productCursorFields(sort?: string) {
  switch (sort) {
    case 'price_asc':
      return [
        { field: 'price', direction: 'asc' as const },
        { field: 'id', direction: 'desc' as const },
      ];
    case 'price_desc':
      return [
        { field: 'price', direction: 'desc' as const },
        { field: 'id', direction: 'desc' as const },
      ];
    case 'oldest':
      return [
        { field: 'createdAt', direction: 'asc' as const },
        { field: 'id', direction: 'asc' as const },
      ];
    default:
      return [
        { field: 'createdAt', direction: 'desc' as const },
        { field: 'id', direction: 'desc' as const },
      ];
  }
}

export function buildProductCursorWhere(
  cursor: CursorPayload,
  sort?: string,
): Prisma.ProductWhereInput[] {
  const fields = productCursorFields(sort);
  const expectedKeys = fields.map(({ field }) => field).sort();
  const cursorKeys = Object.keys(cursor).sort();
  const id = cursor.id;
  const primary = cursor[fields[0].field];

  if (
    cursorKeys.length !== expectedKeys.length ||
    cursorKeys.some((key, index) => key !== expectedKeys[index]) ||
    typeof id !== 'string' ||
    id.length === 0 ||
    (fields[0].field === 'createdAt' &&
      (!(primary instanceof Date) || !Number.isFinite(primary.getTime()))) ||
    (fields[0].field === 'price' &&
      ((typeof primary !== 'string' && typeof primary !== 'number') ||
        !Number.isFinite(Number(primary))))
  ) {
    throw new BadRequestException(
      'Invalid product cursor for the selected sort order.',
    );
  }

  return fields.map(({ field, direction }, index) => {
    const where: Record<string, unknown> = {};
    for (let previous = 0; previous < index; previous += 1) {
      const previousField = fields[previous].field;
      where[previousField] = cursor[previousField];
    }
    where[field] = {
      [direction === 'asc' ? 'gt' : 'lt']: cursor[field],
    };
    return where;
  });
}

export function productCursorPayload(
  product: { id: string; createdAt: Date; price: Prisma.Decimal },
  sort?: string,
): CursorPayload {
  return sort === 'price_asc' || sort === 'price_desc'
    ? { price: product.price.toString(), id: product.id }
    : { createdAt: product.createdAt, id: product.id };
}

/* --------------------------------------------------------------------------
 * Prisma relation selections
 * ------------------------------------------------------------------------ */

/**
 * Full product selection used by admin/mutation operations.
 */
export const productInclude = {
  category: {
    select: categorySelect,
  },

  images: {
    select: {
      id: true,
      url: true,
      position: true,
    },
    orderBy: {
      position: 'asc' as const,
    },
  },

  vendor: {
    select: {
      id: true,
      storeName: true,
      storeSlug: true,
      storeLogoUrl: true,
      isVerified: true,
    },
  },

  variants: {
    where: {
      isDeleted: false,
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
    select: variantSelect,
  },
} as const;

/**
 * Public list selection.
 *
 * We still return variants because your existing PublicProductResponseDto
 * expects them, but we only retrieve active/non-deleted variants and the
 * first two product images.
 */
export const publicListProductInclude = {
  category: {
    select: categorySelect,
  },

  images: {
    select: {
      id: true,
      url: true,
      position: true,
    },
    orderBy: {
      position: 'asc' as const,
    },
    take: 2,
  },

  vendor: {
    select: {
      id: true,
      storeName: true,
      storeSlug: true,
      storeLogoUrl: true,
      isVerified: true,
    },
  },

  variants: {
    where: {
      isDeleted: false,
      isActive: true,
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
    select: publicVariantSelect,
  },
} as const;

/**
 * Public product detail selection.
 *
 * Full images and active variants are returned.
 */
export const publicProductInclude = {
  category: {
    select: categorySelect,
  },

  images: {
    select: {
      id: true,
      url: true,
      position: true,
    },
    orderBy: {
      position: 'asc' as const,
    },
  },

  vendor: {
    select: {
      id: true,
      storeName: true,
      storeSlug: true,
      storeLogoUrl: true,
      storeDescription: true,
      isVerified: true,
    },
  },

  variants: {
    where: {
      isDeleted: false,
      isActive: true,
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
    select: publicVariantSelect,
  },
} as const;

/**
 * Vendor selection.
 *
 * Deleted variants remain visible to the vendor because this is their
 * management view.
 */
export const vendorProductInclude = {
  category: {
    select: categorySelect,
  },

  images: {
    select: {
      id: true,
      url: true,
      position: true,
    },
    orderBy: {
      position: 'asc' as const,
    },
  },

  vendor: {
    select: {
      id: true,
      storeName: true,
      storeSlug: true,
      storeLogoUrl: true,
      storeDescription: true,
    },
  },

  variants: {
    where: {
      isDeleted: false,
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
    select: publicVariantSelect,
  },
} as const;

/**
 * Admin listing selection.
 *
 * Includes deletion metadata and variant timestamps.
 */
export const adminListInclude = {
  category: {
    select: categorySelect,
  },

  images: {
    select: {
      id: true,
      url: true,
      position: true,
    },
    orderBy: {
      position: 'asc' as const,
    },
  },

  vendor: {
    select: {
      id: true,
      storeName: true,
      storeSlug: true,
      storeLogoUrl: true,
      storeDescription: true,
    },
  },

  variants: {
    where: {
      isDeleted: false,
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
    select: adminVariantSelect,
  },
} as const;

/** The database ordering for a product list's `sort` value (newest by default). */
export function resolveProductOrderBy(
  sort?: string,
): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ price: 'asc' }, { id: 'desc' }];
    case 'price_desc':
      return [{ price: 'desc' }, { id: 'desc' }];
    case 'oldest':
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    case 'newest':
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}
