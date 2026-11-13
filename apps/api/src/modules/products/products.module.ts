import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { RedisModule } from '@api/infrastructure/redis/redis.module';
import { SearchModule } from '@api/modules/search/search.module';
import { ProductController } from './controllers/product.controller';
import { DiscoverController } from './controllers/discover.controller';
import { AdminProductsController } from './controllers/admin-product.controller';
import { VendorProductsController } from './controllers/vendor-products.controller';
import { ProductVariantsController } from './controllers/product-variants.controller';
import { AdminProductVariantsController } from './controllers/admin-product-variant.controller';
import { VendorProductVariantsController } from './controllers/vendor-product-variants.controller';
import { ProductsService } from './products.service';
import { ProductVariantsService } from './product-variants.service';
import { LowStockCron } from './jobs/low-stock.cron';

@Module({
  imports: [PrismaModule, RedisModule, SearchModule],
  controllers: [
    ProductController,
    DiscoverController,
    AdminProductsController,
    VendorProductsController,
    ProductVariantsController,
    AdminProductVariantsController,
    VendorProductVariantsController,
  ],
  providers: [ProductsService, ProductVariantsService, LowStockCron],
  exports: [ProductsService, ProductVariantsService],
})
export class ProductsModule {}
