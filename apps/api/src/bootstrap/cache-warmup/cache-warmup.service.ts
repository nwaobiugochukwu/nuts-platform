import { roleCan } from '@api/config/process-role.config';
import { CategoriesService } from '@api/modules/categories/services/categories.service';
import { PublicPromotionsService } from '@api/modules/discounts/services/public-promotions.service';
import { ProductCatalogService } from '@api/modules/products/services/product-catalog.service';
import { VendorsService } from '@api/modules/vendors/services/vendors.service';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';

/**
 * Fills the public caches shortly after the api starts.
 *
 * Right after a deploy or restart every cache is empty, so the first visitors paid
 * 1 to 1.6 seconds for the home page data (measured in development). This runs the same
 * service calls the public routes use, in the background, so those visitors hit a warm
 * cache. It never blocks start-up and a failure only costs the warm-up, never the service.
 */
@Injectable()
export class CacheWarmupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CacheWarmupService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!roleCan('http')) return;
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    if (this.config.get<string>('CACHE_WARMUP_ENABLED', 'true') === 'false') {
      return;
    }
    // Let the server start listening first.
    this.timer = setTimeout(() => void this.warm(), 3_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async warm(): Promise<void> {
    const startedAt = Date.now();
    const categories = this.moduleRef.get(CategoriesService, { strict: false });
    const discounts = this.moduleRef.get(PublicPromotionsService, {
      strict: false,
    });
    const products = this.moduleRef.get(ProductCatalogService, {
      strict: false,
    });
    const vendors = this.moduleRef.get(VendorsService, { strict: false });

    const steps: Array<[string, () => Promise<unknown>]> = [
      ['categories', () => categories.getTree(false, false)],
      ['campaigns', () => discounts.getPublicPlatformPromos(undefined)],
      ['featured vendors', () => vendors.findFeaturedPublicVendors(8)],
      ['discover', () => products.findAllPublicCursor({ bypassCache: false })],
    ];

    let warmed = 0;
    for (const [name, run] of steps) {
      try {
        await run();
        warmed += 1;
      } catch (error) {
        this.logger.warn(
          `Cache warm-up skipped "${name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    this.logger.log(
      `Cache warm-up finished: ${warmed}/${steps.length} in ${Date.now() - startedAt}ms`,
    );
  }
}
