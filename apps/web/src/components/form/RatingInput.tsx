"use client";

import { cn } from "@/lib/util";
import { Star } from "lucide-react";
import { Controller,useFormContext } from "react-hook-form";

interface RatingInputProps {
  name: string;
  label?: string;
}

export function RatingInput({ name, label }: RatingInputProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext();

  return (
    <div className="space-y-1">
      {label && <span className="text-sm font-medium block">{label}</span>}
      <Controller
        name={name}
        control={control}
        render={({ field }) => {
          const value = field.value ?? 0;
          const setRating = (v: number) => field.onChange(v);
          return (
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Rate ${n}`}
                  onClick={() => setRating(n)}
                  className={cn(
                    "p-0.5",
                    value >= n ? "text-amber-400" : "text-muted-foreground/40",
                  )}
                >
                  <Star
                    className={cn(
                      "h-5 w-5",
                      value >= n ? "fill-current" : "",
                    )}
                  />
                </button>
              ))}
            </div>
          );
        }}
      />
      {errors[name] && (
        <p className="text-sm text-destructive">{(errors[name]?.message as string) ?? "Invalid"}</p>
      )}
    </div>
  );
}
