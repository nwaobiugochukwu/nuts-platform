// ── Reviews ──────────────────────────────────────────────────────────────────

export interface CreateReviewDto {
  rating: number;
  comment?: string;
  productId: string;
}

export interface ReviewResponseDto {
  id: string;
  rating: number;
  comment?: string | null;
  productId: string;
  userId: string;
  userFirstName?: string | null;
  userLastName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductReviewsMetaDto {
  total: number;
  averageRating: number;
  ratingBreakdown: Record<number, number>;
}

export interface ProductReviewsSummaryDto {
  items: ReviewResponseDto[];
  total: number;
  averageRating: number;
  ratingBreakdown: Record<number, number>;
}