"use client";

import type { DiscountTargetsDto } from "@/api/dto/discount";
import Link from "@/components/navigation/AppLink";

/**
 * "Applies to: ..." line for a voucher, linking to what it covers so a
 * shopper holding a targeted code always knows where to use it.
 */
export function VoucherAppliesTo({ targets }: { targets?: DiscountTargetsDto | null }) {
  if (!targets || targets.kind === "ALL") return null;

  const storeHref = targets.store ? `/vendor/${encodeURIComponent(targets.store.slug)}` : null;
  const extra = Math.max(0, targets.productCount - targets.products.length);

  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">Applies to: </span>
      {targets.kind === "STORE" && targets.store && (
        <>
          everything from{" "}
          <Link href={storeHref!} className="font-semibold text-foreground underline underline-offset-2">
            {targets.store.name}
          </Link>
        </>
      )}
      {targets.kind === "PRODUCTS" && (
        <>
          {targets.products.map((product, index) => (
            <span key={product.id}>
              {index > 0 && ", "}
              <Link
                href={`/product/${encodeURIComponent(product.slug)}`}
                className="font-semibold text-foreground underline underline-offset-2"
              >
                {product.name}
              </Link>
            </span>
          ))}
          {extra > 0 && ` and ${extra} more`}
          {targets.store && <> · from {targets.store.name}</>}
        </>
      )}
      {targets.kind === "CATEGORIES" &&
        targets.categories.map((category, index) => (
          <span key={category.id}>
            {index > 0 && ", "}
            <Link
              href={`/category/${encodeURIComponent(category.slug)}`}
              className="font-semibold text-foreground underline underline-offset-2"
            >
              {category.name}
            </Link>
          </span>
        ))}
    </p>
  );
}
