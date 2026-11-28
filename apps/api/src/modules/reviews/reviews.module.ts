import { Module } from '@nestjs/common';
import { ReviewsController } from './controllers/reviews.controller';
import { ReviewAggregateConsumer } from './consumers/review-aggregate.consumer';
import { ReviewAggregateService } from './services/review-aggregate.service';
import { ReviewsService } from './services/reviews.service';

@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewAggregateService, ReviewAggregateConsumer],
  exports: [ReviewsService],
})
export class ReviewsModule {}
