/** Products related by co-purchase and category. */
import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { ProductsService } from '@api/modules/products/services/products.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';

import {
  PURCHASE_STATUSES,
  AVAILABLE_PRODUCT,
  scoreAndDiversify,
} from '../utils/recommendation.util';

@Injectable()
export class RelatedProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  async related(productId: string) {
    const fetcher = async () => {
      const product = await this.prisma.product.findFirst({
        where: {
          id: productId,
          isActive: true,
          isDeleted: false,
          category: { is: { isActive: true } },
        },
        select: {
          id: true,
          categoryId: true,
          vendorId: true,
          category: { select: { parentId: true } },
        },
      });
      if (!product) return [];

      const siblingCategories = product.category.parentId
        ? await this.prisma.category.findMany({
            where: { parentId: product.category.parentId, isActive: true },
            select: { id: true },
          })
        : [];
      const categoryIds = [
        ...new Set([
          product.categoryId,
          ...siblingCategories.map(({ id }) => id),
        ]),
      ];

      const coPurchased = await this.prisma.orderItem.groupBy({
        by: ['productId'],
        where: {
          productId: { not: productId },
          order: {
            status: { in: PURCHASE_STATUSES },
            orderItems: { some: { productId } },
          },
          product: {
            isActive: true,
            isDeleted: false,
            category: { is: { isActive: true } },
            vendor: { isActive: true, isApproved: true },
            ...AVAILABLE_PRODUCT,
          },
        },
        _sum: { quantity: true },
        _count: { _all: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 100,
      });
      const contentCandidates = await this.prisma.product.findMany({
        where: {
          id: { not: productId },
          isActive: true,
          isDeleted: false,
          category: { is: { isActive: true } },
          vendor: { isActive: true, isApproved: true },
          AND: [
            AVAILABLE_PRODUCT,
            {
              OR: [
                { categoryId: { in: categoryIds } },
                { vendorId: product.vendorId },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          name: true,
          description: true,
          categoryId: true,
          vendorId: true,
          createdAt: true,
          category: { select: { name: true } },
        },
      });

      const coPurchaseScores = new Map(
        coPurchased.map((item) => [
          item.productId,
          Math.log1p(item._sum.quantity ?? 0) * 4 +
            Math.log1p(item._count._all) * 3,
        ]),
      );
      const contentProducts = new Map(
        contentCandidates.map((candidate) => [candidate.id, candidate]),
      );
      const coPurchaseOnlyIds = coPurchased
        .map(({ productId: id }) => id)
        .filter((id) => !contentProducts.has(id));
      const coPurchaseOnly = coPurchaseOnlyIds.length
        ? await this.prisma.product.findMany({
            where: {
              id: { in: coPurchaseOnlyIds },
              isActive: true,
              isDeleted: false,
              category: { is: { isActive: true } },
              vendor: { isActive: true, isApproved: true },
              ...AVAILABLE_PRODUCT,
            },
            select: {
              id: true,
              name: true,
              description: true,
              categoryId: true,
              vendorId: true,
              createdAt: true,
              category: { select: { name: true } },
            },
          })
        : [];

      const candidates = [...contentCandidates, ...coPurchaseOnly];
      const recommendedIds = scoreAndDiversify(
        candidates,
        new Set([productId]),
        new Map(categoryIds.map((id) => [id, 2])),
        new Map([[product.vendorId, 1]]),
        new Map(),
        coPurchaseScores,
      );
      // Keep the PDP shelf tied to the current product's co-purchase and catalog
      // relationships. Generic trending items are not a valid related fallback.
      return this.products.findPublicCardsByIds(recommendedIds, true);
    };

    return this.cacheService
      ? this.cacheService.wrap(
          `recommendations:related:${productId}`,
          180,
          fetcher,
        )
      : fetcher();
  }
}
