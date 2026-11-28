import { Module } from '@nestjs/common';
import { TrackingModule } from '@api/modules/tracking/tracking.module';
import { WishlistController } from './controllers/wishlist.controller';
import { WishlistService } from './services/wishlist.service';

@Module({
  imports: [TrackingModule],
  controllers: [WishlistController],
  providers: [WishlistService],
  exports: [WishlistService],
})
export class WishlistsModule {}
