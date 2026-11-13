import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { AdminSearchController } from './controllers/admin-search.controller';
import { SearchController } from './controllers/search.controller';
import { VendorSearchController } from './controllers/vendor-search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    SearchController,
    AdminSearchController,
    VendorSearchController,
  ],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
