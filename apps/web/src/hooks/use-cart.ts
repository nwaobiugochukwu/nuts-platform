import { cartService } from "@/api/cart";
import type { RecommendationAttribution } from "@/api/modules/analytics";
import type {
CartItemResponseDto,
CartResponseDto,
} from "@/api/dto/cart";
import { queryKey } from "@/lib/query-key";
import { useAuthStore } from "@/zustand/auth";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

function matchesCartItem(
  line: CartItemResponseDto,
  productId: string,
  variantId?: string,
  allLines?: CartItemResponseDto[]
): boolean {
  if (line.productId !== productId) return false;
  if (variantId) return line.variant?.id === variantId;
  if (allLines) {
    const linesForProduct = allLines.filter((l) => l.productId === productId);
    if (linesForProduct.length === 1) return true;
  }
  return !line.variant;
}

export function useCart(initialData?: CartResponseDto | null) {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id);
  const canPurchase = useAuthStore((state) => state.capabilities?.canPurchase ?? false);
  const isCustomerSession = isAuthenticated && canPurchase;

  const { data, isLoading, error } = useQuery<CartResponseDto>({
    queryKey: queryKey.cart,
    queryFn: async () => (await cartService.get()).data,
    enabled: isCustomerSession,
    initialData: initialData ?? undefined,
    staleTime: 1000 * 60 * 15,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const invalidateForYou = useCallback(
    () => queryClient.invalidateQueries({
      queryKey: ["recommendations", "for-you", userId ?? null],
      refetchType: "all",
    }),
    [queryClient, userId],
  );

  const invalidateCart = useCallback(
    () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKey.cart }),
      invalidateForYou(),
    ]).then(() => undefined),
    [invalidateForYou, queryClient]
  );

  const updateItem = useMutation({
    mutationFn: ({
      productId,
      delta,
      variantId,
    }: {
      productId: string;
      delta: number;
      variantId?: string;
    }) => {
      if (!isCustomerSession) return Promise.reject(new Error("Cart operations require a customer account."));
      return cartService.updateItem(productId, {
        quantity: delta,
        ...(variantId ? { variantId } : {}),
      });
    },
    onMutate: async ({ productId, delta, variantId }) => {
      await queryClient.cancelQueries({ queryKey: queryKey.cart });
      const previous = queryClient.getQueryData<CartResponseDto>(queryKey.cart);

      queryClient.setQueryData<CartResponseDto>(queryKey.cart, (current: CartResponseDto | undefined) => {
        if (!current) return current;

        const target = current.cartItems.find((line: CartItemResponseDto) =>
          matchesCartItem(line, productId, variantId, current.cartItems)
        );

        if (!target) return current;

        const nextQuantity = target.quantity + delta;
        const nextItems =
          nextQuantity <= 0
            ? current.cartItems.filter((line) => line !== target)
            : current.cartItems.map((line) =>
                line === target ? { ...line, quantity: nextQuantity } : line
              );

        return {
          ...current,
          cartItems: nextItems,
          cart: {
            ...current.cart,
            totalItemCount: Math.max(0, current.cart.totalItemCount + delta),
            subtotal: Math.max(0, current.cart.subtotal + target.price * delta),
            totalAmount: Math.max(0, current.cart.totalAmount + target.price * delta),
          },
        };
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey.cart, context.previous);
      }
    },
    onSuccess: ({ data: cart }) => {
      queryClient.setQueryData(queryKey.cart, cart);
      void invalidateForYou();
    },
  });

  const removeItem = useMutation({
    mutationFn: ({ productId, variantId }: { productId: string; variantId?: string }) => {
      if (!isCustomerSession) return Promise.reject(new Error("Cart operations require a customer account."));
      return cartService.removeItem(productId, variantId);
    },
    onMutate: async ({ productId, variantId }) => {
      await queryClient.cancelQueries({ queryKey: queryKey.cart });
      const previous = queryClient.getQueryData<CartResponseDto>(queryKey.cart);

      queryClient.setQueryData<CartResponseDto>(queryKey.cart, (current: CartResponseDto | undefined) => {
        if (!current) return current;

        const target = current.cartItems.find((line: CartItemResponseDto) =>
          matchesCartItem(line, productId, variantId, current.cartItems)
        );

        if (!target) return current;

        return {
          ...current,
          cartItems: current.cartItems.filter((line) => line !== target),
          cart: {
            ...current.cart,
            totalItemCount: Math.max(0, current.cart.totalItemCount - target.quantity),
            subtotal: Math.max(0, current.cart.subtotal - target.price * target.quantity),
            totalAmount: Math.max(0, current.cart.totalAmount - target.price * target.quantity),
          },
        };
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey.cart, context.previous);
      }
    },
    onSuccess: ({ data: response }) => {
      queryClient.setQueryData(queryKey.cart, response.cart);
      void invalidateForYou();
    },
  });

  const clearCart = useMutation({
    mutationFn: () => {
      if (!isCustomerSession) return Promise.reject(new Error("Cart operations require a customer account."));
      return cartService.clear();
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKey.cart });
      const previous = queryClient.getQueryData<CartResponseDto>(queryKey.cart);
      if (previous) {
        queryClient.setQueryData<CartResponseDto>(queryKey.cart, {
          ...previous,
          cart: {
            ...previous.cart,
            subtotal: 0,
            totalAmount: 0,
            totalItemCount: 0,
            updatedAt: new Date(),
          },
          cartItems: [],
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey.cart, context.previous);
      }
    },
    onSuccess: ({ data: cart }) => {
      queryClient.setQueryData(queryKey.cart, cart);
      void invalidateForYou();
    },
  });

  const addItem = useMutation({
    mutationFn: ({
      productId,
      quantity,
      variantId,
      recommendationContext,
    }: {
      productId: string;
      quantity?: number;
      variantId?: string;
      productName?: string;
      productSlug?: string;
      price?: number;
      variantName?: string;
      addedFrom?: unknown;
      path?: string;
      recommendationContext?: RecommendationAttribution;
    }) => {
      if (!isCustomerSession) return Promise.reject(new Error("Cart operations require a customer account."));
      return cartService.addItem(productId, {
        quantity: quantity ?? 1,
        ...(variantId ? { variantId } : {}),
        ...(recommendationContext ? { recommendationContext } : {}),
      });
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKey.cart });
      const previous = queryClient.getQueryData<CartResponseDto>(queryKey.cart);
      const quantity = variables.quantity ?? 1;
      const price = Number(variables.price ?? 0);
      const productId = variables.productId;
      const variantId = variables.variantId;
      const productName = variables.productName ?? "Product";
      const productSlug = variables.productSlug ?? "";
      const variantName = variables.variantName;

      queryClient.setQueryData<CartResponseDto>(queryKey.cart, (current: CartResponseDto | undefined) => {
        if (!current) return current;

        const existing = current.cartItems.find(
          (line: CartItemResponseDto) =>
            line.productId === productId &&
            (line.variant?.id ?? null) === (variantId ?? null)
        );

        const nextItems = existing
          ? current.cartItems.map((line) =>
              line === existing
                ? { ...line, quantity: line.quantity + quantity }
                : line
            )
          : [
              ...current.cartItems,
              {
                id: variantId ? `${productId}-${variantId}` : productId,
                cartId: current.cart.id,
                productId,
                quantity,
                price,
                product: {
                  id: productId,
                  name: productName,
                  slug: productSlug,
                  sku: "",
                  price,
                  inStockQuantity: quantity,
                  hasVariants: !!variantId,
                  isActive: true,
                  isVariant: !!variantId,
                  lowStockAlert: false,
                  lowStockQuantity: 0,
                  hasDiscount: false,
                  productAvailability: {
                    canAddToCart: true,
                    isAvailable: true,
                    sku: "",
                  },
                  images: [],
                },
                variant: variantId
                  ? {
                      id: variantId,
                      options: variantName ? [{ name: "Variant", value: variantName }] : [],
                      isActive: true,
                      isDeleted: false,
                    }
                  : null,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ];

        const nextSubtotal = current.cart.subtotal + price * quantity;
        const nextTotal = current.cart.totalAmount + price * quantity;

        return {
          ...current,
          cartItems: nextItems,
          cart: {
            ...current.cart,
            totalItemCount: current.cart.totalItemCount + quantity,
            subtotal: Math.max(0, nextSubtotal),
            totalAmount: Math.max(0, nextTotal),
          },
        };
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey.cart, context.previous);
      }
    },
    onSuccess: ({ data: response }) => {
      const current = queryClient.getQueryData<CartResponseDto>(queryKey.cart);
      if (!current) {
        void invalidateCart();
        return;
      }

      const addedItem = response.addedItem;
      const matchingIndex = current.cartItems.findIndex(
        (line) =>
          line.productId === addedItem.productId &&
          (line.variant?.id ?? null) === (addedItem.variant?.id ?? null)
      );
      const cartItems = [...current.cartItems];
      if (matchingIndex === -1) {
        cartItems.push(addedItem);
      } else {
        cartItems[matchingIndex] = addedItem;
      }
      queryClient.setQueryData<CartResponseDto>(queryKey.cart, {
        cart: response.cart,
        cartItems,
      });
      void invalidateForYou();
    },
  });

  return {
    items: data?.cartItems ?? [],
    cart: data?.cart,
    count: data?.cart.totalItemCount ?? 0,
    isLoading,
    error,
    updateItem,
    removeItem,
    clearCart,
    addItem,
    invalidateCart,
  };
}
