"use client";

import { cn } from "@/lib/util";
import { Star } from "lucide-react";

interface RatingBadgeProps {
  rating: number;
  count?: number;
  className?: string;
  compact?: boolean;
}

export function RatingBadge({
  rating,
  count,
  className,
  compact = false,
}: RatingBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800",
        className,
      )}
    >
      <Star className="h-3 w-3 fill-current text-amber-400" />
      <span>{rating.toFixed(1)}</span>
      {count !== undefined && !compact && (
        <span className="text-amber-600/70">({count})</span>
      )}
    </div>
  );
}
