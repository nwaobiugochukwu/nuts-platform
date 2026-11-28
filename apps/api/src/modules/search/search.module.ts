import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { AdminSearchController } from './controllers/admin-search.controller';
import { SearchController } from './controllers/search.controller';
import { VendorSearchController } from './controllers/vendor-search.controller';
import { AdminIndexSearchService } from './services/admin-index-search.service';
import { AdminSearchService } from './services/admin-search.service';
import { CatalogIndexSearchService } from './services/catalog-index-search.service';
import { SearchCacheService } from './services/search-cache.service';
import { SearchOperationsService } from './services/search-operations.service';
import { SearchRunnerService } from './services/search-runner.service';
import { SearchService } from './services/search.service';
import { VendorSearchService } from './services/vendor-search.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    SearchController,
    AdminSearchController,
    VendorSearchController,
  ],
  providers: [
    SearchService,
    VendorSearchService,
    SearchOperationsService,
    SearchCacheService,
    SearchRunnerService,
    CatalogIndexSearchService,
    AdminIndexSearchService,
    AdminSearchService,
  ],
  exports: [SearchService],
})
export class SearchModule {}
