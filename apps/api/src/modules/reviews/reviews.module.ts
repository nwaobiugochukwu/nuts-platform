import { Module } from '@nestjs/common';
import {
  ProductReviewsCanonicalController,
  ReviewsController,
} from './controllers/reviews.controller';
import { ReviewAggregateConsumer } from './consumers/review-aggregate.consumer';
import { ReviewAggregateService } from './services/review-aggregate.service';
import { ReviewsService } from './services/reviews.service';

@Module({
  controllers: [ReviewsController, ProductReviewsCanonicalController],
  providers: [ReviewsService, ReviewAggregateService, ReviewAggregateConsumer],
  exports: [ReviewsService],
})
export class ReviewsModule {}
