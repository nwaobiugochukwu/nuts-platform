import { publicApi, userApi } from "@/api/core/client";
import type {
CreateReviewDto,
ProductReviewsMetaDto,
ReviewResponseDto,
} from "@/api/dto/review";

export const reviewService = {
  listByProduct(productId: string, signal?: AbortSignal) {
    return publicApi.get<ReviewResponseDto[], ProductReviewsMetaDto>(`/products/${encodeURIComponent(productId)}/reviews`, { signal });
  },
  create(payload: CreateReviewDto) {
    return userApi.post<ReviewResponseDto>("/reviews", payload);
  },
  remove(id: string) {
    return userApi.delete<void>(`/reviews/${id}`);
  },
};