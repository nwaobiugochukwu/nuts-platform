import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';

const MAX_DEPTH = 10;

export async function resolveCategoryIdFromPath(
  prisma: PrismaService,
  path: string,
  options: {
    requireLeaf?: boolean;
  } = {},
): Promise<string> {
  const { requireLeaf = false } = options;

  if (!path || typeof path !== 'string') {
    throw new BadRequestException('Invalid category path');
  }

  const slugs = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!slugs.length) {
    throw new BadRequestException('Invalid category path');
  }

  if (slugs.length > MAX_DEPTH) {
    throw new BadRequestException('Category path too deep');
  }

  // Fetch all candidate categories matching any of the path slugs in a single query
  const candidates = await prisma.category.findMany({
    where: {
      slug: { in: slugs },
      isActive: true,
    },
    select: { id: true, slug: true, parentId: true },
  });

  let parentId: string | null = null;
  let leafId: string | null = null;

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const match = candidates.find(
      (c) => c.slug === slug && c.parentId === parentId,
    );

    if (!match) {
      throw new NotFoundException(`Category path invalid at segment: ${slug}`);
    }

    leafId = match.id;
    parentId = match.id;
  }

  if (!leafId) {
    throw new NotFoundException('Category not found');
  }

  if (requireLeaf) {
    // A leaf is a category with no children
    const children = await prisma.category.count({
      where: { parentId: leafId, isActive: true },
    });

    if (children > 0) {
      throw new BadRequestException('Category is not a leaf node');
    }
  }

  return leafId;
}

export async function buildCategoryPath(
  prisma: PrismaService,
  categoryId: string,
  cache = new Map<string, string>(),
): Promise<string> {
  const segments: string[] = [];
  const visited = new Set<string>();

  let currentId: string | null = categoryId;

  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error('Category cycle detected');
    }
    visited.add(currentId);

    if (cache.has(currentId)) {
      const cachedPath = cache.get(currentId)!;
      const combinedPath = segments.length
        ? `${cachedPath}/${segments.join('/')}`
        : cachedPath;
      cache.set(categoryId, combinedPath);
      return combinedPath;
    }

    const category: {
      slug: string;
      parentId: string | null;
    } | null = await prisma.category.findUnique({
      where: { id: currentId },
      select: {
        slug: true,
        parentId: true,
      },
    });

    if (!category) break;

    segments.unshift(category.slug);
    currentId = category.parentId;
  }

  const path = segments.join('/');

  // Populate cache bottom-up
  let accumulatedPath = '';
  const visitedList = [...visited];
  for (let i = visitedList.length - 1; i >= 0; i--) {
    const id = visitedList[i];
    const slug = segments[i];
    if (slug) {
      accumulatedPath = accumulatedPath ? `${slug}/${accumulatedPath}` : slug;
      cache.set(id, accumulatedPath);
    }
  }

  cache.set(categoryId, path);
  return path;
}

export async function preloadCategoryPaths(
  prisma: PrismaService,
  categoryIds: string[],
  cache = new Map<string, string>(),
): Promise<void> {
  const requestedIds = [...new Set(categoryIds.filter(Boolean))];
  const missingIds = requestedIds.filter((id) => !cache.has(id));
  if (!missingIds.length) {
    return;
  }

  const categoryMap = new Map<
    string,
    {
      id: string;
      slug: string;
      parentId: string | null;
    }
  >();
  const pendingIds = [...missingIds];

  while (pendingIds.length) {
    const batch = pendingIds.splice(0, 50);
    const categories = await prisma.category.findMany({
      where: { id: { in: batch } },
      select: {
        id: true,
        slug: true,
        parentId: true,
      },
    });

    const nextParentIds: string[] = [];
    for (const category of categories) {
      categoryMap.set(category.id, category);
      if (
        category.parentId &&
        !cache.has(category.parentId) &&
        !categoryMap.has(category.parentId) &&
        !pendingIds.includes(category.parentId)
      ) {
        nextParentIds.push(category.parentId);
      }
    }

    for (const id of nextParentIds) {
      if (!pendingIds.includes(id)) {
        pendingIds.push(id);
      }
    }
  }

  const buildPath = (id: string, visited = new Set<string>()): string => {
    if (cache.has(id)) {
      return cache.get(id)!;
    }

    if (visited.has(id)) {
      throw new Error('Category cycle detected');
    }
    visited.add(id);

    const category = categoryMap.get(id);
    if (!category) {
      throw new NotFoundException(`Category not found: ${id}`);
    }

    const path = category.parentId
      ? `${buildPath(category.parentId, visited)}/${category.slug}`
      : category.slug;
    cache.set(id, path);
    return path;
  };

  for (const id of missingIds) {
    if (!cache.has(id)) {
      buildPath(id);
    }
  }
}
