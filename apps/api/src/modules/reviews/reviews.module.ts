import { Module } from '@nestjs/common';
import {
  ProductReviewsCanonicalController,
  ReviewsController,
} from './controllers/reviews.controller';
import { ReviewsService } from './services/reviews.service';

@Module({
  controllers: [ReviewsController, ProductReviewsCanonicalController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
