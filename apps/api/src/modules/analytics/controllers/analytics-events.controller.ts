import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ProductViewsService } from '../tracking/product-views/product-views.service';
import { SearchTrackingService } from '../tracking/search-tracking/search-tracking.service';
import { TrackEventDto } from '../dto/track-event.dto';
import { Public } from '@api/common/decorators/public.decorator';
import {
  GuestBehaviorEventDto,
  RecommendationEventDto,
  RecommendationEventsBatchDto,
} from '../tracking/recommendation-events.dto';
import { RecommendationEventsService } from '../tracking/recommendation-events.service';

@ApiTags('ANALYTICS EVENTS')
@Controller('analytics/events')
export class AnalyticsEventsController {
  constructor(
    private readonly productViews: ProductViewsService,
    private readonly searchTracking: SearchTrackingService,
    private readonly recommendationEvents: RecommendationEventsService,
  ) {}

  @Post()
  @Roles(ROLE.USER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Analytics event accepted')
  @ApiOperation({ summary: 'Record a supported user behavior event' })
  async track(
    @GetUser('id') userId: string,
    @Body() event: TrackEventDto,
  ): Promise<{ accepted: true }> {
    if (event.event === 'product_view' && event.productId) {
      await this.productViews.trackView(
        event.productId,
        userId,
        event.sessionId,
        event.visitorId,
        event.id,
      );
    } else if (
      event.event === 'search' &&
      event.query &&
      event.resultsCount !== undefined
    ) {
      await this.searchTracking.trackSearch(
        event.query.trim().slice(0, 100),
        event.resultsCount,
        userId,
        event.sessionId,
      );
    }
    return { accepted: true };
  }

  @Post('recommendations')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Recommendation event accepted')
  @ApiOperation({ summary: 'Record an anonymous recommendation interaction' })
  recordGuestRecommendation(@Body() event: RecommendationEventDto) {
    return this.recommendationEvents.record(undefined, event);
  }

  @Post('recommendations/batch')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Recommendation events accepted')
  @ApiOperation({
    summary: 'Record anonymous recommendation interactions in a batch',
  })
  recordGuestRecommendations(@Body() batch: RecommendationEventsBatchDto) {
    return this.recommendationEvents.recordMany(undefined, batch.events);
  }

  @Post('recommendations/authenticated')
  @Roles(ROLE.USER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Recommendation event accepted')
  @ApiOperation({ summary: 'Record a customer recommendation interaction' })
  recordCustomerRecommendation(
    @GetUser('id') userId: string,
    @Body() event: RecommendationEventDto,
  ) {
    return this.recommendationEvents.record(userId, event);
  }

  @Post('recommendations/authenticated/batch')
  @Roles(ROLE.USER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Recommendation events accepted')
  @ApiOperation({
    summary: 'Record customer recommendation interactions in a batch',
  })
  recordCustomerRecommendations(
    @GetUser('id') userId: string,
    @Body() batch: RecommendationEventsBatchDto,
  ) {
    return this.recommendationEvents.recordMany(userId, batch.events);
  }

  @Post('guest')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Guest behavior event accepted')
  @ApiOperation({ summary: 'Record anonymous product views and searches' })
  async trackGuest(@Body() event: GuestBehaviorEventDto) {
    if (event.event === 'product_view' && event.productId) {
      await this.productViews.trackView(
        event.productId,
        undefined,
        event.sessionId,
        event.visitorId,
        event.id,
      );
    } else if (
      event.event === 'search' &&
      event.query &&
      event.resultsCount !== undefined
    ) {
      await this.searchTracking.trackSearch(
        event.query.trim().slice(0, 100),
        event.resultsCount,
        undefined,
        event.sessionId,
      );
    }
    return { accepted: true };
  }
}
