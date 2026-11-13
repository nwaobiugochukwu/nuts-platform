import { Injectable, Logger } from '@nestjs/common';
import { RABBITMQ_ROUTING_KEYS } from '@api/infrastructure/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/rabbitmq/rabbitmq.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';

@Injectable()
export class SearchTrackingService {
  private readonly logger = new Logger(SearchTrackingService.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Track a search query for analytics.
   */
  async trackSearch(
    query: string,
    resultsCount: number,
    userId?: string,
    sessionId?: string,
  ): Promise<void> {
    let published = false;
    try {
      published = await this.rabbitmq.publish(
        RABBITMQ_ROUTING_KEYS.ANALYTICS_EVENT,
        {
          type: 'search',
          query,
          resultsCount,
          userId,
          sessionId,
          timestamp: new Date().toISOString(),
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not publish search behavior event; persisting directly: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!published) {
      // RabbitMQ's offline publisher returns false (rather than throwing). Store
      // the signal in Postgres so a broker outage cannot silently freeze
      // personalized recommendations.
      await this.prisma.searchQuery.create({
        data: {
          query,
          resultsCount,
          userId: userId ?? null,
          sessionId: sessionId ?? null,
        },
      });
    }

    if (resultsCount === 0) {
      this.logger.debug({ query }, 'Zero-result search tracked');
    }
  }
}
