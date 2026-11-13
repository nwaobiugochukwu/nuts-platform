export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface CursorPaginationMeta {
  hasNextPage: boolean;
  nextCursor?: string | null;
  limit: number;
}

export interface ApiSuccessEnvelope<T> {
  success: true;
  statusCode: number;
  message?: string;
  data: T;
  meta?: PaginationMeta | CursorPaginationMeta;
  timestamp: string;
}

export interface ApiErrorEnvelope {
  success: false;
  statusCode: number;
  message: string;
  error?: string;
  details?: unknown;
  timestamp: string;
  path?: string;
}

export interface ApiResult<T> {
  data: T;
  meta?: PaginationMeta | CursorPaginationMeta;
  message?: string;
}
