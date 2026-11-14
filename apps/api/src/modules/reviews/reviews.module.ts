import { Module } from '@nestjs/common';
import {
  ProductReviewsCanonicalController,
  ReviewsController,
} from './controllers/reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  controllers: [ReviewsController, ProductReviewsCanonicalController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
