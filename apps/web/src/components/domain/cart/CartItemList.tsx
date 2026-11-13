"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import type { CartItemResponseDto } from "@/api/dto/cart";
import { Button } from "@/component/ui/button";
import { Card,CardContent } from "@/component/ui/card";
import { useCart } from "@/hooks/use-cart";
import { formatPrice } from "@/lib/util";
import { Minus,Plus,ShoppingBag,Trash2 } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { toast } from "sonner";

export function CartItemList({
  items,
}: {
  items: CartItemResponseDto[];
  cartAddedFrom?: unknown;
}) {
  const { updateItem, removeItem, clearCart } = useCart();

  if (items.length === 0) return null;

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const productHref = `/product/${item.product.slug}`;
        return (
          <Card key={item.id} className="rounded-2xl border-border/70 shadow-xs">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <Link
                  href={productHref}
                  className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-secondary/50 flex items-center justify-center hover:opacity-90 transition-opacity"
                >
                  {item.product.images?.[0]?.url ? (
                    <RemoteImage
                      src={item.product.images[0].url}
                      alt={item.product.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ShoppingBag className="h-8 w-8 text-muted-foreground/40" />
                  )}
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={productHref} className="block hover:text-primary transition-colors">
                    <h3 className="font-semibold text-foreground text-sm line-clamp-1">
                      {item.product.name}
                    </h3>
                  </Link>
                  {item.variant && item.variant.options.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {item.variant.options.map((o) => `${o.name}: ${o.value}`).join(", ")}
                    </p>
                  )}
                  <p className="text-sm font-bold text-foreground mt-1">
                    {formatPrice(item.price)} × {item.quantity}
                  </p>
                </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={updateItem.isPending}
                  onClick={() => updateItem.mutate({ productId: item.productId, delta: -1, variantId: item.variant?.id })}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={updateItem.isPending}
                  onClick={() => updateItem.mutate({ productId: item.productId, delta: 1, variantId: item.variant?.id })}
                >
                  <Plus className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:bg-destructive/10"
                  disabled={removeItem.isPending}
                  onClick={() =>
                    removeItem.mutate(
                      { productId: item.productId, variantId: item.variant?.id },
                      { onSuccess: () => toast.success("Item removed from cart") }
                    )
                  }
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        onClick={() => clearCart.mutate(undefined, { onSuccess: () => toast.success("Cart cleared") })}
        disabled={clearCart.isPending}
        className="rounded-xl text-xs text-muted-foreground hover:text-destructive"
      >
        Clear Cart
      </Button>
    </div>
  );
}
