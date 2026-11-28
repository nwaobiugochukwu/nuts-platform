import { MAX_LIMIT } from '../constants/search.constants';
import type { SearchIndex } from '../types/search.types';

export function filterIndexes(
  requested: SearchIndex[] | undefined,
  allowed: SearchIndex[],
): SearchIndex[] {
  if (!requested?.length) {
    return [...allowed];
  }

  return requested.filter((index) => allowed.includes(index));
}

export function normalizeSearch(search: string): string {
  return search.trim().replace(/\s+/g, ' ');
}

export function normalizePage(page: number): number {
  if (!Number.isFinite(page)) {
    return 1;
  }

  return Math.max(1, Math.floor(page));
}

export function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 10;
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export function buildCacheKey(
  namespace: string,
  ...parts: Array<string | number>
): string {
  return [
    'search',
    namespace,
    ...parts.map((part) => encodeURIComponent(String(part))),
  ].join(':');
}
