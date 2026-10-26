"use client";

import { getApiErrorMessage } from "@/api/core/error";
import type { InitializePaymentResponseDto } from "@/api/dto/payment";
import type { UserResponseDto } from "@/api/dto/user";
import { orderService, type CheckoutPayload } from "@/api/order";
import { paymentService } from "@/api/payment";
import { Button } from "@/component/ui/button";
import { clearClientCart } from "@/lib/cart-cleanup";
import { queryKey } from "@/lib/query-key";
import { safePaystackCheckoutUrl } from "@/lib/safe-paystack-url";
import { extractStockConflict } from "@/lib/stock-conflict";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface CheckoutFlowProps {
  onOrderCreated?: (orderId: string) => void;
  user: UserResponseDto | null;
}

export function CheckoutFlow({ onOrderCreated, user }: CheckoutFlowProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    if (!user?.shippingInformation) {
      toast.error("No shipping information on file");
      return;
    }
    setLoading(true);
    try {
      const { fullName, phone, street, city, state, country } =
        user.shippingInformation;
      const { data: order } = await orderService.checkout({
        shippingAddress: { fullName, phone, street, city, state, country },
      } as CheckoutPayload);
      const orderId = order.id;
      clearClientCart(queryClient);
      onOrderCreated?.(orderId);

      // Initialize Paystack payment directly (Paystack handles 3DS/card/bank verification)
      try {
        const { data: res }: { data: InitializePaymentResponseDto } =
          await paymentService.initialize(orderId);

        if (res.authorizationUrl) {
          const checkoutUrl = safePaystackCheckoutUrl(res.authorizationUrl);
          if (checkoutUrl) {
            window.location.assign(checkoutUrl);
            return;
          }
        }
      } catch (initErr: unknown) {
        toast.error(
          getApiErrorMessage(
            initErr,
            "Order created, but payment gateway could not be opened. Please retry from your order details."
          )
        );
      }

      router.push(`/order/${encodeURIComponent(orderId)}`);
    } catch (err: unknown) {
      const conflict = extractStockConflict(err);
      if (conflict) {
        queryClient.invalidateQueries({ queryKey: queryKey.cart });
        toast.error(conflict.message);
        router.push("/cart");
      } else {
        toast.error(getApiErrorMessage(err, "Checkout failed"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      className="w-full"
      onClick={handleCheckout}
      disabled={loading || !user}
    >
      {loading ? "Processing..." : "Proceed to Pay"}
    </Button>
  );
}
