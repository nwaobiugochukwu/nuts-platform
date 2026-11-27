import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, ROLE } from '@prisma/client';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { TrackingQueueService } from './tracking-queue.service';
import type { RecommendationEventDto } from '../dto/recommendation-events.dto';

const CLIENT_TRACKABLE_EVENTS = new Set([
  'IMPRESSION',
  'CLICK',
  'DISMISS',
  'CATEGORY_VIEW',
]);

@Injectable()
export class RecommendationEventsService {
  private readonly logger = new Logger(RecommendationEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly queue?: TrackingQueueService,
  ) {}

  /** Clicks, dismissals and category views change what we should recommend. */
  private async refreshRecommendations(
    userId: string | null | undefined,
    sessionIds: Array<string | null | undefined>,
    events: Array<{ eventType: string }>,
  ) {
    if (!events.some((e) => e.eventType !== 'IMPRESSION')) return;
    await this.cache?.invalidateRecommendations(userId, ...sessionIds);
  }

  /** Queues the events; true when the broker confirmed them. */
  private enqueueEvents(
    effectiveUserId: string | null,
    cacheUserId: string | undefined,
    events: RecommendationEventDto[],
  ): Promise<boolean> {
    if (!this.queue) return Promise.resolve(false);
    return this.queue.enqueue({
      type: 'recommendation_events',
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        surface: event.surface,
        requestId: event.requestId,
        rankerVersion: event.rankerVersion,
        position: event.position,
        productId: event.productId,
        vendorId: event.vendorId,
        categoryId: event.categoryId,
        userId: effectiveUserId,
        sessionId: event.sessionId,
      })),
      // Impressions do not change what to recommend; clicks, dismissals and category views do.
      refreshFor: events.some((e) => e.eventType !== 'IMPRESSION')
        ? [cacheUserId, ...events.map((e) => e.sessionId)]
        : [],
    });
  }

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

    if (
      !CLIENT_TRACKABLE_EVENTS.has(event.eventType) ||
      (!event.productId && !event.vendorId && !event.categoryId)
    ) {
      return { accepted: false };
    }

    const effectiveUserId = userRole === ROLE.VENDOR ? null : (userId ?? null);

    // Preferred path: hand it to the analytics queue (no database write in the request, and the
    // feed is refreshed once per burst of clicks). If the broker is down, store it here as before.
    if (await this.enqueueEvents(effectiveUserId, userId, [event])) {
      return { accepted: true };
    }

    try {
      await this.prisma.recommendationEvent.create({
        data: {
          id: event.id,
          eventType: event.eventType,
          surface: event.surface,
          requestId: event.requestId,
          rankerVersion: event.rankerVersion,
          position: event.position,
          productId: event.productId,
          vendorId: event.vendorId,
          categoryId: event.categoryId,
          userId: effectiveUserId,
          sessionId: event.sessionId,
        },
      });
      await this.refreshRecommendations(userId, [event.sessionId], [event]);
      return { accepted: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' ||
          error.code === 'P2003' ||
          error.code === 'P2025')
      ) {
        // Event IDs are idempotent (P2002), and stale or missing references (P2003/P2025)
        // are accepted gracefully to prevent telemetry failures from interrupting storefront flows.
        return { accepted: true };
      }
      this.logger.warn(
        `Failed to store recommendation event: ${error instanceof Error ? error.message : String(error)}`,
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
        CLIENT_TRACKABLE_EVENTS.has(event.eventType) &&
        (event.productId || event.vendorId || event.categoryId) &&
        !(userRole === ROLE.VENDOR && userId && event.vendorId === userId),
    );
    if (acceptedEvents.length === 0) return { accepted: true, stored: 0 };

    const effectiveUserId = userRole === ROLE.VENDOR ? null : (userId ?? null);

    if (await this.enqueueEvents(effectiveUserId, userId, acceptedEvents)) {
      return { accepted: true, stored: acceptedEvents.length };
    }

    try {
      const result = await this.prisma.recommendationEvent.createMany({
        data: acceptedEvents.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          surface: event.surface,
          requestId: event.requestId,
          rankerVersion: event.rankerVersion,
          position: event.position,
          productId: event.productId,
          vendorId: event.vendorId,
          categoryId: event.categoryId,
          userId: effectiveUserId,
          sessionId: event.sessionId,
        })),
        skipDuplicates: true,
      });
      await this.refreshRecommendations(
        userId,
        acceptedEvents.map((e) => e.sessionId),
        acceptedEvents,
      );
      return { accepted: true, stored: result.count };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' ||
          error.code === 'P2025' ||
          error.code === 'P2002')
      ) {
        this.logger.warn(
          `Recommendation event batch contained invalid references or duplicates: ${error.message}`,
        );
        return { accepted: true, stored: 0 };
      }
      this.logger.warn(
        `Failed to store recommendation event batch: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { accepted: false, stored: 0 };
    }
  }
}
