export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UNPROCESSABLE"
  | "SERVER_ERROR"
  | (string & {});

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems?: number;
  total?: number;
  totalPages: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

export interface CursorPaginationMeta {
  limit: number;
  hasNextPage: boolean;
  nextCursor: string | null;
  totalItems?: number;
}

export interface ApiErrorDetail {
  code?: string;
  field?: string;
  message?: string;
}

export interface ApiErrorInfo {
  code?: ApiErrorCode;
  details?: ApiErrorDetail[] | unknown;
  meta?: Record<string, unknown>;
}

export interface ApiSuccessEnvelope<T> {
  success: true;
  message?: string;
  meta?: PaginationMeta | CursorPaginationMeta;
  timestamp?: string;
  data: T;
}

export interface ApiErrorEnvelope {
  success: false;
  message: string;
  error?: ApiErrorInfo;
  timestamp?: string;
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export interface ImageRefDto {
  url: string;
  publicId: string;
  isCover: boolean;
}

export type OrderStatus =
  | "PENDING"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";

export type PaymentStatus =
  | "PENDING"
  | "COMPLETED"
  | "FAILED"
  | "REFUNDED"
  | "CANCELLED"
  | (string & {});

export type DiscountCodeType = "PERCENTAGE" | "FIXED";
export type DiscountCodeScope = "GLOBAL" | "CATEGORY" | "PRODUCT" | "VENDOR";
export type WalletTransactionType = "CREDIT" | "DEBIT";
export type WalletTransactionReason =
  | "SALE"
  | "REFUND"
  | "WITHDRAWAL"
  | "PAYOUT"
  | "REFERRAL"
  | "ADJUSTMENT"
  | (string & {});

export type DisplayMode = "SHOWCASE" | "CATALOG" | (string & {});

export type Role =
  | "USER"
  | "ADMIN"
  | "VENDOR"
  | "user"
  | "admin"
  | "vendor";

export interface VariantOption {
  name: string;
  value: string;
}

export interface VariantCombinations {
  [key: string]: string[];
}

export type { };
