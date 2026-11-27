import { InventoryConsumer } from './consumers/inventory.consumer';
import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { RedisModule } from '@api/infrastructure/cache/redis.module';
import { SearchModule } from '@api/modules/search/search.module';
import { NotificationsModule } from '@api/modules/notifications/notifications.module';
import { ProductController } from './controllers/product.controller';
import { DiscoverController } from './controllers/discover.controller';
import { AdminProductsController } from './controllers/admin-product.controller';
import { VendorProductsController } from './controllers/vendor-products.controller';
import { ProductVariantsController } from './controllers/product-variants.controller';
import {
  AdminProductVariantsCanonicalController,
  AdminProductVariantsController,
} from './controllers/admin-product-variant.controller';
import {
  VendorProductVariantsCanonicalController,
  VendorProductVariantsController,
} from './controllers/vendor-product-variants.controller';
import { ProductsService } from './services/products.service';
import { ProductVariantsService } from './services/product-variants.service';
import { LowStockJob } from './jobs/low-stock.job';

@Module({
  imports: [PrismaModule, RedisModule, SearchModule, NotificationsModule],
  controllers: [
    ProductController,
    DiscoverController,
    AdminProductsController,
    VendorProductsController,
    ProductVariantsController,
    AdminProductVariantsController,
    AdminProductVariantsCanonicalController,
    VendorProductVariantsController,
    VendorProductVariantsCanonicalController,
  ],
  providers: [
    ProductsService,
    ProductVariantsService,
    LowStockJob,
    InventoryConsumer,
  ],
  exports: [ProductsService, ProductVariantsService],
})
export class ProductsModule {}
