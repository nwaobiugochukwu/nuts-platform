import { Module } from '@nestjs/common';
import { ShopperActivityModule } from '@api/modules/shopper-activity/shopper-activity.module';
import { WishlistController } from './controllers/wishlist.controller';
import { WishlistService } from './services/wishlist.service';

@Module({
  imports: [ShopperActivityModule],
  controllers: [WishlistController],
  providers: [WishlistService],
  exports: [WishlistService],
})
export class WishlistsModule {}
