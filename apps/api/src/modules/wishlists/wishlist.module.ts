import { Module } from '@nestjs/common';
import { AnalyticsModule } from '@api/modules/analytics/analytics.module';
import { WishlistController } from './controllers/wishlist.controller';
import { WishlistService } from './wishlist.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [WishlistController],
  providers: [WishlistService],
  exports: [WishlistService],
})
export class WishlistsModule {}

export const WishlistModule = WishlistsModule;
