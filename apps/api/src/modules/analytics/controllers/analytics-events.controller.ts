import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { ProductViewsService } from '../tracking/product-views/product-views.service';
import { SearchTrackingService } from '../tracking/search-tracking/search-tracking.service';
import { TrackEventDto } from '../dto/track-event.dto';
import {
  RecommendationEventDto,
  RecommendationEventsBatchDto,
} from '../tracking/recommendation-events.dto';
import { RecommendationEventsService } from '../tracking/recommendation-events.service';
import { MarketplaceEventsService } from '../tracking/marketplace-events.service';
import { OptionalAuth } from '@api/common/decorators/optional-auth.decorator';
import { StoreViewDto } from '../tracking/dto/store-view.dto';
import { randomUUID } from 'node:crypto';

interface StoreViewEventPayload {
  id?: string;
  vendorId?: string;
  sessionId?: string;
  visitorId?: string;
  event?: string;
  eventType?: string;
  productId?: string;
  query?: string;
}

@ApiTags('ANALYTICS EVENTS')
@Controller('analytics/events')
export class AnalyticsEventsController {
  constructor(
    private readonly productViews: ProductViewsService,
    private readonly searchTracking: SearchTrackingService,
    private readonly recommendationEvents: RecommendationEventsService,
    private readonly marketplaceEvents: MarketplaceEventsService,
  ) {}

  @Post()
  @OptionalAuth()
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Analytics event accepted')
  @ApiOperation({
    summary:
      'Record any user behavior, storefront, recommendation, or batch analytics event',
  })
  async track(
    @GetUser('id') userId: string | undefined,
    @Body()
    payload:
      | TrackEventDto
      | RecommendationEventDto
      | RecommendationEventsBatchDto
      | StoreViewDto
      | Record<string, unknown>,
  ): Promise<{ accepted: boolean }> {
    if (!payload || typeof payload !== 'object') {
      return { accepted: false };
    }

    // 1. Batch events payload support: { events: [...] }
    if ('events' in payload && Array.isArray(payload.events)) {
      return this.recommendationEvents.recordMany(
        userId,
        payload.events as RecommendationEventDto[],
      );
    }

    // 2. Recommendation events (CLICK, IMPRESSION, CATEGORY_VIEW, etc.)
    if (
      'eventType' in payload &&
      typeof payload.eventType === 'string' &&
      payload.eventType &&
      payload.eventType !== 'STORE_VIEW'
    ) {
      return this.recommendationEvents.record(
        userId,
        payload as RecommendationEventDto,
      );
    }

    // 3. Store view event
    const raw = payload as StoreViewEventPayload;
    if (
      raw.event === 'store_view' ||
      raw.eventType === 'STORE_VIEW' ||
      (typeof raw.vendorId === 'string' && !raw.productId && !raw.query)
    ) {
      if (raw.vendorId) {
        return this.marketplaceEvents.recordStoreView(
          raw.vendorId,
          {
            id: raw.id || randomUUID(),
            sessionId: raw.sessionId,
            visitorId: raw.visitorId,
          },
          userId,
        );
      }
      return { accepted: false };
    }

    // 4. Product view event
    const trackEvent = payload as TrackEventDto;
    if (trackEvent.event === 'product_view' && trackEvent.productId) {
      await this.productViews.trackView(
        trackEvent.productId,
        userId,
        trackEvent.sessionId,
        trackEvent.visitorId,
        trackEvent.id,
      );
      return { accepted: true };
    }

    // 5. Search event
    if (
      trackEvent.event === 'search' &&
      trackEvent.query &&
      trackEvent.resultsCount !== undefined
    ) {
      await this.searchTracking.trackSearch(
        trackEvent.query.trim().slice(0, 100),
        trackEvent.resultsCount,
        userId,
        trackEvent.sessionId,
      );
      return { accepted: true };
    }

    return { accepted: true };
  }
}
