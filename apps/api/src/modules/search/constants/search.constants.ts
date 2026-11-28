import type { SearchIndex } from '../types/search.types';

export const MARKETPLACE_INDEXES: SearchIndex[] = [
  'products',
  'vendors',
  'categories',
];

export const ADMIN_INDEXES: SearchIndex[] = [
  'products',
  'vendors',
  'categories',
  'users',
  'orders',
  'discount_codes',
];

export const VENDOR_INDEXES: SearchIndex[] = [
  'products',
  'orders',
  'discount_codes',
];

export const MAX_LIMIT = 50;

export const MIN_SEARCH_LENGTH = 2;

export const SIMILARITY_THRESHOLD = 0.25;

export const CACHE_TTL_SECONDS = 900;
