import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { AdminSearchController } from './controllers/admin-search.controller';
import { SearchController } from './controllers/search.controller';
import { VendorSearchController } from './controllers/vendor-search.controller';
import { SearchCacheService } from './services/search-cache.service';
import { SearchOperationsService } from './services/search-operations.service';
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
  ],
  exports: [SearchService],
})
export class SearchModule {}
