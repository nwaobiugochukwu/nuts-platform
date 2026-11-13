"use client";

import { reviewService } from "@/api";
import { getApiErrorMessage } from "@/api/core/error";
import { RatingInput } from "@/component/form/RatingInput";
import { Button } from "@/component/ui/button";
import {
Dialog,
DialogContent,
DialogDescription,
DialogFooter,
DialogHeader,
DialogTitle,
DialogTrigger,
} from "@/component/ui/dialog";
import { Label } from "@/component/ui/label";
import { Textarea } from "@/component/ui/textarea";
import { queryKey } from "@/lib/query-key";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation,useQueryClient } from "@tanstack/react-query";
import React,{ useState } from "react";
import { Controller,FormProvider,useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const reviewSchema = z.object({
  rating: z.number().min(1, "Select a rating").max(5),
  comment: z.string().optional(),
});

type ReviewForm = z.infer<typeof reviewSchema>;

export function WriteReviewDialog({
  productId,
  productName,
  children,
}: {
  productId: string;
  productName: string;
  children: React.ReactNode;
}) {
  const qc = useQueryClient();
  const form = useForm<ReviewForm>({ resolver: zodResolver(reviewSchema) });

  const [open, setOpen] = useState(false);
const create = useMutation({
    mutationFn: (body: ReviewForm) =>
      reviewService.create({ ...body, productId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKey.product.review(productId) });
      qc.invalidateQueries({ queryKey: queryKey.review.all });
      toast.success("Review submitted");
      setOpen(false);
      form.reset();
    },
    onError: (err: unknown) =>
      toast.error(getApiErrorMessage(err, "Failed to submit review")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <FormProvider {...form}>
          <form
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Review {productName}</DialogTitle>
              <DialogDescription>Share your experience with other buyers.</DialogDescription>
            </DialogHeader>
            <RatingInput name="rating" label="Rating" />
            <div className="space-y-1">
              <Label htmlFor="comment">Comment (optional)</Label>
              <Controller
                name="comment"
                control={form.control}
                render={({ field }) => <Textarea id="comment" {...field} />}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Posting..." : "Submit review"}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
    );
}
