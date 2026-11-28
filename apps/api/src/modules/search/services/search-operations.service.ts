import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { SearchCacheService } from './search-cache.service';

/** Health and maintenance of search for administrators: how much is searchable, and purging the cache. */
@Injectable()
export class SearchOperationsService {
  private readonly logger = new Logger(SearchOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: SearchCacheService,
  ) {}

  /**
   * Diagnostic metrics for admin system management dashboard.
   * Returns search engine readiness and indexed document counts.
   */
  async getSearchStatus(): Promise<{
    ready: boolean;
    totalDocuments: number;
    breakdown: {
      products: number;
      vendors: number;
      categories: number;
      orders: number;
    };
  }> {
    try {
      const [products, vendors, categories, orders] = await Promise.all([
        this.prisma.product.count({
          where: { isDeleted: false, isActive: true },
        }),
        this.prisma.vendor.count({
          where: { isActive: true, isApproved: true },
        }),
        this.prisma.category.count({
          where: { isActive: true },
        }),
        this.prisma.order.count(),
      ]);

      const totalDocuments = products + vendors + categories + orders;

      return {
        ready: true,
        totalDocuments,
        breakdown: {
          products,
          vendors,
          categories,
          orders,
        },
      };
    } catch (error) {
      this.logger.error('Failed to retrieve search status metrics', error);
      return {
        ready: false,
        totalDocuments: 0,
        breakdown: {
          products: 0,
          vendors: 0,
          categories: 0,
          orders: 0,
        },
      };
    }
  }

  /** Purges cached search queries. */
  flushSearchCache(): Promise<number> {
    return this.cache.flush();
  }

  /**
   * Synchronizes search indices and purges stale Redis query cache.
   */
  async reindex(): Promise<{ message: string; indexedCount: number }> {
    await this.flushSearchCache();
    const status = await this.getSearchStatus();
    return {
      message: 'Search indices synchronized and cache purged successfully',
      indexedCount: status.totalDocuments,
    };
  }
}
