import { productViewEventId } from '@api/common/utils/product-view-event-id.util';
import type { EventEnvelope } from '@api/infrastructure/messaging/events/event-envelope.types';
import { isEventEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { randomUUID } from 'node:crypto';
import type {
  ShopperAction,
  ShopperActivityBody,
} from '../types/shopper-activity.types';
import {
  actionForActivityType,
  actionForShelfType,
  bodyFromRow,
  eventNameFor,
  shopperAggregate,
} from './shopper-activity.mapper';

/**
 * Reads the tracking messages the previous release published: one routing key (`analytics.event`)
 * and a home-made `type` field inside the body (`product_view`, `search`, `recommendation_events`,
 * `marketplace_event`). During a rolling deploy old API processes keep publishing that shape for a
 * while, and any left in the queue must still be stored, so the consumer converts them to shopper
 * activity before handling them.
 *
 * Remove this file, and the `analytics.event` binding, one release after the rename has fully
 * rolled out.
 *
 * Returns the converted events (an old recommendation batch becomes one event per interaction),
 * `'ignore'` for an old-shape message that was never worth storing (missing the field it is about;
 * the old consumer acknowledged those and so does this), or `null` when the message is not in the
 * old shape at all.
 */
export function adaptLegacyTrackingMessage(
  raw: unknown,
): EventEnvelope[] | 'ignore' | null {
  if (raw === null || raw === undefined) return 'ignore';
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (isEventEnvelope(raw)) return null;

  const message = raw as Record<string, unknown>;
  if (typeof message.type !== 'string') return null;

  const occurredAt = occurredAtOf(message.timestamp);
  const envelope = (
    action: ShopperAction,
    body: ShopperActivityBody,
  ): EventEnvelope => ({
    eventId: body.id,
    type: eventNameFor(action),
    version: 1,
    occurredAt,
    aggregate: shopperAggregate(body, body.id),
    actor: { type: 'system' as const },
    payload: body,
  });

  switch (message.type) {
    case 'product_view': {
      if (typeof message.productId !== 'string') return 'ignore';
      const id =
        typeof message.id === 'string'
          ? message.id
          : productViewEventId({
              productId: message.productId,
              userId: message.userId as string | null | undefined,
              visitorId: message.visitorId as string | null | undefined,
              sessionId: message.sessionId as string | null | undefined,
              timestamp: message.timestamp as
                | string
                | number
                | Date
                | undefined,
            });
      return [envelope('product_viewed', bodyFromRow({ ...message, id }, id))];
    }
    case 'search': {
      if (typeof message.query !== 'string' || !message.query) return 'ignore';
      const id = typeof message.id === 'string' ? message.id : randomUUID();
      return [
        envelope('searched', {
          ...bodyFromRow({ ...message, id }, id),
          query: message.query,
          resultsCount:
            typeof message.resultsCount === 'number' ? message.resultsCount : 0,
        }),
      ];
    }
    case 'recommendation_events': {
      if (!Array.isArray(message.events)) return 'ignore';
      const events = (message.events as Array<Record<string, unknown>>).flatMap(
        (row) => {
          const action =
            typeof row.eventType === 'string'
              ? actionForShelfType(row.eventType)
              : undefined;
          return action
            ? [envelope(action, bodyFromRow(row, randomUUID()))]
            : [];
        },
      );
      return events.length > 0 ? events : 'ignore';
    }
    case 'marketplace_event': {
      const row = message.event as Record<string, unknown> | undefined;
      if (!row || typeof row.eventType !== 'string') return 'ignore';
      const action = actionForActivityType(row.eventType);
      if (!action) return 'ignore';
      return [envelope(action, bodyFromRow(row, randomUUID()))];
    }
    default:
      return 'ignore';
  }
}

function occurredAtOf(value: unknown): string {
  const date =
    typeof value === 'string' ||
    typeof value === 'number' ||
    value instanceof Date
      ? new Date(value)
      : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}
