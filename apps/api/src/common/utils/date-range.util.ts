import { BadRequestException } from '@nestjs/common';

export const ANALYTICS_TIME_ZONE = 'Africa/Lagos';
export const ANALYTICS_EVENT_RETENTION_DAYS = 730;
const MAX_ANALYTICS_RANGE_MS = ANALYTICS_EVENT_RETENTION_DAYS * 86_400_000;

export interface DailyAnalyticsPoint {
  date: string;
  value: number;
}

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

/** Fill calendar-day gaps using the same reporting timezone as SQL buckets. */
export function fillAnalyticsDateGaps<T extends DailyAnalyticsPoint>(
  data: T[],
  start: Date,
  end: Date,
): DailyAnalyticsPoint[] {
  const byDate = new Map(data.map(({ date, value }) => [date, value]));
  const startKey = dateKeyInTimeZone(start, ANALYTICS_TIME_ZONE);
  const endKey = dateKeyInTimeZone(end, ANALYTICS_TIME_ZONE);
  const cursor = new Date(`${startKey}T00:00:00.000Z`);
  const finalDay = new Date(`${endKey}T00:00:00.000Z`);
  const result: DailyAnalyticsPoint[] = [];

  while (cursor <= finalDay) {
    const key = cursor.toISOString().slice(0, 10);
    result.push({ date: key, value: byDate.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

/**
 * Parses optional startDate/endDate query params into Date objects.
 * Falls back to defaults (start = `defaultDaysAgo` days ago, end = now).
 */
export function parseDateRange(
  startDate?: string,
  endDate?: string,
  defaultDaysAgo = 30,
): { start: Date; end: Date } {
  const parseBound = (value: string, isEnd: boolean): Date => {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      throw new BadRequestException(
        `${isEnd ? 'endDate' : 'startDate'} must be a valid ISO date`,
      );
    }

    // Date-only end bounds include the whole selected calendar day.
    if (isEnd && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      parsed.setUTCHours(23, 59, 59, 999);
    }
    return parsed;
  };

  const end = endDate ? parseBound(endDate, true) : new Date();
  const start = startDate
    ? parseBound(startDate, false)
    : new Date(end.getTime() - defaultDaysAgo * 86_400_000);

  // Clamp end to now if it's in the future
  const now = new Date();
  if (end > now) end.setTime(now.getTime());

  if (start > end) {
    throw new BadRequestException(
      'startDate must be before or equal to endDate',
    );
  }

  if (end.getTime() - start.getTime() > MAX_ANALYTICS_RANGE_MS) {
    throw new BadRequestException(
      `Analytics date ranges cannot exceed ${ANALYTICS_EVENT_RETENTION_DAYS} days.`,
    );
  }

  return { start, end };
}
