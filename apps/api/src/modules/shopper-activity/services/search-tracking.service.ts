import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ShopperActivityRecorderService } from './shopper-activity-recorder.service';

@Injectable()
export class SearchTrackingService {
  private readonly logger = new Logger(SearchTrackingService.name);

  constructor(private readonly recorder: ShopperActivityRecorderService) {}

  /**
   * Records a search as shopper activity. What it changes in the shopper's recommendations is worked
   * out once it is stored (see `feedRefreshFor`), not here.
   */
  async trackSearch(
    query: string,
    resultsCount: number,
    userId?: string,
    sessionId?: string,
    visitorId?: string,
  ): Promise<void> {
    await this.recorder.record({
      action: 'searched',
      id: randomUUID(),
      query,
      resultsCount,
      userId: userId ?? null,
      sessionId: sessionId ?? null,
      visitorId: visitorId ?? null,
    });

    if (resultsCount === 0) {
      this.logger.debug({ query }, 'Zero-result search tracked');
    }
  }
}
