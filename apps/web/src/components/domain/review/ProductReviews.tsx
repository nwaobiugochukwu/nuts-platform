"use client";

import { reviewService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import type { ProductReviewsMetaDto,ReviewResponseDto } from "@/api/dto/review";
import { Button } from "@/component/ui/button";
import { queryKey } from "@/lib/query-key";
import { useAuthStore } from "@/zustand/auth";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { CheckCircle2,MessageSquarePlus,Star,Trash2,X } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useState } from "react";
import { toast } from "sonner";

interface ProductReviewsProps {
  productId: string;
  averageRating?: number;
  reviewCount?: number;
  initialReviews?: {
    data: ReviewResponseDto[];
    meta?: ProductReviewsMetaDto;
  } | null;
}

export function ProductReviews({
  productId,
  averageRating,
  reviewCount,
  initialReviews,
}: ProductReviewsProps) {
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuthStore();
  const currentUserId = user?.id;

  const [formOpen, setFormOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");

  const hasInitialData = Boolean(initialReviews && initialReviews.data);

  const { data: reviewResponse, isLoading } = useQuery({
    queryKey: queryKey.product.review(productId),
    enabled: Boolean(productId) && !hasInitialData,
    queryFn: ({ signal }) => reviewService.listByProduct(productId, signal),
    initialData: initialReviews ? { data: initialReviews.data, meta: initialReviews.meta } : undefined,
    staleTime: 1000 * 60 * 15,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const createReviewMutation = useMutation({
    mutationFn: (payload: { productId: string; rating: number; comment?: string }) =>
      reviewService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKey.product.review(productId) });
      toast.success("Review submitted successfully!");
      setFormOpen(false);
      setComment("");
      setRating(5);
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, "Unable to submit your review"));
    },
  });

  const removeReviewMutation = useMutation({
    mutationFn: (id: string) => reviewService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKey.product.review(productId) });
      toast.success("Review deleted");
    },
    onError: (error: unknown) => {
      toast.error(getApiErrorMessage(error, "Unable to delete review"));
    },
  });

  const reviewsList = reviewResponse?.data ?? [];
  const meta = reviewResponse?.meta;
  const total = meta?.total ?? reviewCount ?? reviewsList.length;
  const average =
    meta?.averageRating ??
    averageRating ??
    (reviewsList.length
      ? reviewsList.reduce((sum, r) => sum + r.rating, 0) / reviewsList.length
      : 0);
  const ratingBreakdown = meta?.ratingBreakdown ?? { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      toast.error("Please sign in to write a review");
      return;
    }
    if (rating < 1 || rating > 5) {
      toast.error("Please select a rating between 1 and 5 stars");
      return;
    }
    createReviewMutation.mutate({
      productId,
      rating,
      comment: comment.trim() || undefined,
    });
  };

  const ratingLabels: Record<number, string> = {
    1: "Poor",
    2: "Fair",
    3: "Good",
    4: "Very Good",
    5: "Excellent",
  };

  return (
    <section className="mt-16 border-t border-border pt-10" aria-labelledby="reviews-heading">
      {/* Header & Score Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-8 border-b border-border/60">
        <div>
          <h2 id="reviews-heading" className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            Customer Reviews
          </h2>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }, (_, i) => (
                <Star
                  key={i}
                  className={`h-4 w-4 ${
                    i < Math.round(average)
                      ? "fill-black text-black"
                      : "text-neutral-200"
                  }`}
                />
              ))}
            </div>
            <span className="text-sm font-semibold text-foreground">
              {average.toFixed(1)} out of 5
            </span>
            <span className="text-xs text-muted-foreground">
              ({total} {total === 1 ? "review" : "reviews"})
            </span>
          </div>

          {total > 0 && (
            <div className="mt-4 max-w-xs space-y-1.5 pt-2">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = ratingBreakdown[star] ?? 0;
                const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={star} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                    <span className="w-10 font-medium flex items-center gap-1">
                      {star} <Star className="h-3 w-3 fill-black text-black inline" />
                    </span>
                    <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-black rounded-full transition-all duration-300"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono text-[11px]">
                      {percentage}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          {isAuthenticated ? (
            <Button
              type="button"
              onClick={() => setFormOpen((prev) => !prev)}
              className="gap-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium px-5 shadow-xs"
            >
              {formOpen ? <X className="h-4 w-4" /> : <MessageSquarePlus className="h-4 w-4" />}
              {formOpen ? "Cancel Review" : "Write a Review"}
            </Button>
          ) : (
            <Button
              asChild
              variant="outline"
              className="rounded-full text-sm font-medium border-neutral-300"
            >
              <Link href="/auth/login">Sign in to Review</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Write a Review Form */}
      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="my-8 rounded-2xl border border-border bg-[#fafafa] p-6 shadow-xs animate-in fade-in-0 duration-200"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Write Your Review</h3>
            <span className="text-xs text-muted-foreground">Verified Purchase Review</span>
          </div>

          {/* Star Rating Picker */}
          <div className="mb-4">
            <span className="block text-sm font-medium text-foreground mb-1.5">
              Overall Rating
            </span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => {
                  const isFilled = (hoverRating || rating) >= star;
                  return (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => setRating(star)}
                      className="p-1 text-neutral-300 hover:scale-110 transition-transform focus:outline-none"
                    >
                      <Star
                        className={`h-6 w-6 ${
                          isFilled ? "fill-black text-black" : "text-neutral-300"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
              <span className="text-xs font-semibold text-foreground ml-2">
                {ratingLabels[hoverRating || rating]}
              </span>
            </div>
          </div>

          {/* Comment Field */}
          <div className="mb-5">
            <label htmlFor="review-comment" className="block text-sm font-medium text-foreground mb-1.5">
              Your Review (Optional)
            </label>
            <textarea
              id="review-comment"
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What did you love about this product?"
              className="w-full rounded-xl border border-input bg-white p-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
              maxLength={1000}
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFormOpen(false)}
              className="rounded-full text-xs font-semibold"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createReviewMutation.isPending}
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold px-6 shadow-xs"
            >
              {createReviewMutation.isPending ? "Submitting..." : "Submit Review"}
            </Button>
          </div>
        </form>
      )}

      {/* Reviews Listing */}
      <div className="mt-8 space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-neutral-100" />
            ))}
          </div>
        ) : reviewsList.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-12 text-center">
            <p className="font-semibold text-foreground">No reviews yet</p>
            <p className="mt-1 font-semibold text-muted-foreground">
              Be the first to share your thoughts on this product.
            </p>
          </div>
        ) : (
          reviewsList.map((review: ReviewResponseDto) => {
            const authorName =
              [review.userFirstName, review.userLastName].filter(Boolean).join(" ") ||
              "Verified Customer";
            const isAuthor = currentUserId === review.userId;

            return (
              <article
                key={review.id}
                className="rounded-2xl border border-border/70 bg-white p-5 transition-shadow hover:shadow-xs"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    {/* Stars */}
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star
                          key={i}
                          className={`h-3.5 w-3.5 ${
                            i < review.rating
                              ? "fill-black text-black"
                              : "text-neutral-200"
                          }`}
                        />
                      ))}
                    </div>

                    {/* Author & Verified Tag */}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">
                        {authorName}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="h-3 w-3" /> Verified Purchase
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <time className="text-xs text-muted-foreground">
                      {new Date(review.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </time>
                    {isAuthor && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm("Are you sure you want to delete your review?")) {
                            removeReviewMutation.mutate(review.id);
                          }
                        }}
                        disabled={removeReviewMutation.isPending}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                        title="Delete review"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {review.comment && (
                  <p className="mt-3 text-sm leading-relaxed text-neutral-700 whitespace-pre-line">
                    {review.comment}
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
