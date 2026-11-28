import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { ProductViewsService } from '../services/product-views.service';
import { SearchTrackingService } from '../services/search-tracking.service';
import { TrackEventDto } from '../dto/track-event.dto';
import {
  RecommendationEventDto,
  RecommendationEventsBatchDto,
} from '../dto/recommendation-events.dto';
import { RecommendationEventsService } from '../services/recommendation-events.service';
import { ShopperActivityService } from '../services/shopper-activity.service';
import { OptionalAuth } from '@api/common/decorators/optional-auth.decorator';
import { StoreViewDto } from '../dto/store-view.dto';
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
export class ActivityEventsController {
  private readonly logger = new Logger(ActivityEventsController.name);

  constructor(
    private readonly productViews: ProductViewsService,
    private readonly searchTracking: SearchTrackingService,
    private readonly recommendationEvents: RecommendationEventsService,
    private readonly shopperActivity: ShopperActivityService,
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
    @GetUser('role') userRole: ROLE | undefined,
    @Body()
    payload:
      | TrackEventDto
      | RecommendationEventDto
      | RecommendationEventsBatchDto
      | StoreViewDto
      | Record<string, unknown>,
  ): Promise<{ accepted: boolean }> {
    try {
      if (!payload || typeof payload !== 'object') {
        return { accepted: false };
      }

      // Administrators viewing their own store or the platform should never pollute analytics
      if (userRole === ROLE.ADMIN) {
        return { accepted: true };
      }

      // 1. Batch events payload support: { events: [...] }
      if ('events' in payload && Array.isArray(payload.events)) {
        return await this.recommendationEvents.recordMany(
          userId,
          payload.events as RecommendationEventDto[],
          userRole,
        );
      }

      // 2. Recommendation events (CLICK, IMPRESSION, CATEGORY_VIEW, etc.)
      if (
        'eventType' in payload &&
        typeof payload.eventType === 'string' &&
        payload.eventType &&
        payload.eventType !== 'STORE_VIEW'
      ) {
        return await this.recommendationEvents.record(
          userId,
          payload as RecommendationEventDto,
          userRole,
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
          // Vendor viewing their own store: drop self-view telemetry
          if (userRole === ROLE.VENDOR && raw.vendorId === userId) {
            return { accepted: true };
          }
          return await this.shopperActivity.storeViewed(
            raw.vendorId,
            {
              id: raw.id || randomUUID(),
              sessionId: raw.sessionId,
              visitorId: raw.visitorId,
            },
            userId,
            userRole,
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
          userRole,
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
          userRole === ROLE.VENDOR ? undefined : userId,
          trackEvent.sessionId,
          trackEvent.visitorId,
        );
        return { accepted: true };
      }

      return { accepted: true };
    } catch (error) {
      this.logger.warn(
        `Analytics telemetry caught and accepted gracefully: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { accepted: true };
    }
  }
}
