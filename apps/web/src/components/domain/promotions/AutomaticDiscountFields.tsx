"use client";

import { FormInput } from "@/components/form/FormInput";
import { Sparkles } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";

/**
 * "How does the shopper get this discount?" for the vendor and admin discount
 * forms: by typing/claiming a code (default), or automatically when their cart
 * meets the target. Needs a react-hook-form context with `autoApply` and
 * `minQuantity` fields.
 */
export function AutomaticDiscountFields({ locked = false }: { locked?: boolean }) {
  const { register, control } = useFormContext();
  const autoApply = Boolean(useWatch({ control, name: "autoApply" }));

  return (
    <div className="space-y-3 rounded-2xl border border-border/80 bg-muted/20 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="autoApply"
          disabled={locked}
          {...register("autoApply")}
          className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        />
        <label htmlFor="autoApply" className="cursor-pointer select-none text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Apply automatically (no code needed)
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Shoppers do not enter or claim anything. The discount is applied at checkout whenever
            their cart meets the targets below, and the better of an automatic offer and a code the
            shopper holds is used. {locked && "This cannot be changed after the discount is created."}
          </span>
        </label>
      </div>

      {autoApply && (
        <FormInput
          name="minQuantity"
          label="Minimum items in the cart (optional)"
          type="number"
          placeholder="e.g. 3 for “buy 3 or more”"
          hint="Counts only items this discount covers. Leave empty for no quantity target."
        />
      )}
    </div>
  );
}
