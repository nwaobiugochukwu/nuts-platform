"use client";

import type { CartMetadataDto } from "@/api/dto/cart";
import type { UserResponseDto } from "@/api/dto/user";
import { CheckoutFlow } from "@/component/cart/CheckoutFlow";
import { Button } from "@/component/ui/button";
import { Card,CardContent,CardFooter } from "@/component/ui/card";
import { formatPrice } from "@/lib/util";

export function CartSummary({
  cart,
  user,
  itemCount,
}: {
  cart?: CartMetadataDto;
  user: UserResponseDto | null;
  itemCount: number;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{formatPrice(cart?.subtotal ?? 0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Delivery</span>
          <span>{formatPrice(cart?.deliveryCharge ?? 0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Service</span>
          <span>{formatPrice(cart?.serviceCharge ?? 0)}</span>
        </div>
        <div className="border-t pt-2 font-bold flex justify-between">
          <span>Total</span>
          <span className="text-primary">{formatPrice(cart?.totalAmount ?? 0)}</span>
        </div>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        {itemCount > 0 && <CheckoutFlow user={user} />}
        <Button variant="outline" className="w-full">
          {/* clear handled in CartItemList; this is a spacer */}
          Continue Shopping
        </Button>
      </CardFooter>
    </Card>
  );
}