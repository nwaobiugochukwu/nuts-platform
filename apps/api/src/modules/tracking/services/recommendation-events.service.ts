import { Injectable, Logger } from '@nestjs/common';
import { ROLE } from '@prisma/client';
import type { RecommendationEventDto } from '../dto/recommendation-events.dto';
import type { ShopperActivity } from '../types/tracking.types';
import { actionForShelfType } from '../utils/tracking.mapper';
import { TrackingRecorderService } from './tracking-recorder.service';

/** The interaction types a browser may report; the rest are recorded by the server. */
const CLIENT_TRACKABLE_EVENTS = new Set([
  'IMPRESSION',
  'CLICK',
  'DISMISS',
  'CATEGORY_VIEW',
]);

/**
 * Takes in what a shopper did with a recommendation shelf (saw an item, clicked it, dismissed it,
 * opened a category) as shopper activity: one activity per interaction.
 */
@Injectable()
export class RecommendationEventsService {
  private readonly logger = new Logger(RecommendationEventsService.name);

  constructor(private readonly recorder: TrackingRecorderService) {}

  async record(
    userId: string | undefined,
    event: RecommendationEventDto,
    userRole?: ROLE,
  ) {
    if (userRole === ROLE.ADMIN) {
      return { accepted: true };
    }
    if (userRole === ROLE.VENDOR && userId && event.vendorId === userId) {
      return { accepted: true };
    }
    if (!this.isTrackable(event)) {
      return { accepted: false };
    }

    try {
      await this.recorder.recordMany([
        {
          activity: this.toActivity(
            this.effectiveUserId(userId, userRole),
            event,
          ),
        },
      ]);
      return { accepted: true };
    } catch (error) {
      this.logger.warn(
        `Failed to record recommendation event: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { accepted: false };
    }
  }

  async recordMany(
    userId: string | undefined,
    events: RecommendationEventDto[],
    userRole?: ROLE,
  ) {
    if (userRole === ROLE.ADMIN) {
      return { accepted: true, stored: 0 };
    }

    const acceptedEvents = events.filter(
      (event) =>
        this.isTrackable(event) &&
        !(userRole === ROLE.VENDOR && userId && event.vendorId === userId),
    );
    if (acceptedEvents.length === 0) return { accepted: true, stored: 0 };

    const effectiveUserId = this.effectiveUserId(userId, userRole);
    try {
      await this.recorder.recordMany(
        acceptedEvents.map((event) => ({
          activity: this.toActivity(effectiveUserId, event),
        })),
      );
      return { accepted: true, stored: acceptedEvents.length };
    } catch (error) {
      this.logger.warn(
        `Failed to record recommendation event batch: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { accepted: false, stored: 0 };
    }
  }

  /** A browser may only report the allowed kinds, and about something (a product, store or category). */
  private isTrackable(event: RecommendationEventDto): boolean {
    return (
      CLIENT_TRACKABLE_EVENTS.has(event.eventType) &&
      Boolean(event.productId || event.vendorId || event.categoryId)
    );
  }

  /** A vendor browsing is recorded as an anonymous shopper, never as a customer. */
  private effectiveUserId(
    userId: string | undefined,
    userRole?: ROLE,
  ): string | null {
    return userRole === ROLE.VENDOR ? null : (userId ?? null);
  }

  private toActivity(
    userId: string | null,
    event: RecommendationEventDto,
  ): ShopperActivity {
    return {
      // isTrackable already guarantees a known type, so there is always an action.
      action: actionForShelfType(event.eventType) as ShopperActivity['action'],
      id: event.id,
      surface: event.surface,
      requestId: event.requestId,
      rankerVersion: event.rankerVersion,
      position: event.position,
      productId: event.productId,
      vendorId: event.vendorId,
      categoryId: event.categoryId,
      userId,
      sessionId: event.sessionId,
    };
  }
}
