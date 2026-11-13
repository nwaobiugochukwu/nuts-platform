import type { WishlistResponseDto } from "@/api/dto/wishlist";
import { wishlistService } from "@/api/wishlist";
import { queryKey } from "@/lib/query-key";
import { useAuthStore } from "@/zustand/auth";
import { useWishlistStore } from "@/zustand/wishlist";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { useCallback,useEffect } from "react";
import { toast } from "sonner";

type WishlistToggleProduct = {
  id: string;
  name: string;
  slug: string;
  price: number;
  discountPrice?: number | null;
  thumbnail?: string | null;
  images?: Array<{ url?: string } | string>;
  vendor?: { storeName?: string; storeSlug?: string; isVerified?: boolean };
};

// Simple view item type matching what the page expects
export type WishlistViewItem = {
  id: string;
  productId: string;
  name: string;
  slug: string;
  price: number;
  image?: string | null;
  vendorStore?: string | null;
  variantId?: string | null;
};

const mapServerItem = (item: WishlistResponseDto): WishlistViewItem => ({
  id: item.id, // Use the actual wishlist item ID from server
  productId: item.productId,
  name: item.productName,
  slug: item.productSlug,
  price: Number(item.productPrice ?? 0),
  image: item.productImage ?? null,
  vendorStore: undefined,
  variantId: item.variantId ?? null,
});

export function useWishlist(initialData?: WishlistResponseDto[]) {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id);
  const canPurchase = useAuthStore((state) => state.capabilities?.canPurchase ?? false);
  const isCustomerSession = isAuthenticated && canPurchase;
  const guestItems = useWishlistStore((state) => state.items);
  const invalidateForYou = useCallback(
    () => queryClient.invalidateQueries({
      queryKey: ["recommendations", "for-you", userId ?? null],
      refetchType: "all",
    }),
    [queryClient, userId],
  );

  // Vendor and admin sessions browse the storefront as guests; wishlist
  // endpoints are customer-only.
  const { data: serverItems, isLoading, error } = useQuery<WishlistResponseDto[]>({
    queryKey: queryKey.wishlist,
    queryFn: async () => (await wishlistService.list()).data,
    enabled: isCustomerSession,
    initialData: initialData ?? undefined,
    staleTime: 1000 * 60 * 15,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  // Show error if fetch fails (inside effect, not during render)
  useEffect(() => {
    if (isCustomerSession && error) {
      toast.error("Failed to load wishlist");
    }
  }, [error, isCustomerSession]);

  // Map server items to view items, or use guest items for unauthenticated users
  const items: WishlistViewItem[] = isCustomerSession
    ? (serverItems ?? []).map(mapServerItem)
    : guestItems;

  // Check if a product is in the wishlist
  const isInWishlist = useCallback(
    (productId: string, variantId?: string) => {
      if (isCustomerSession) {
        return (serverItems ?? []).some(
          (item) =>
            item.productId === productId &&
            (!variantId || !item.variantId || item.variantId === variantId)
        );
      }
      return guestItems.some(
        (item) =>
          item.productId === productId &&
          (!variantId || !item.variantId || item.variantId === variantId)
      );
    },
    [guestItems, isCustomerSession, serverItems]
  );

  // Remove item mutation - simple and clean
  const removeItemMutation = useMutation({
    mutationFn: async ({
      productId,
      variantId,
    }: {
      productId: string;
      variantId?: string;
    }) => {
      if (!isCustomerSession) {
        useWishlistStore.getState().removeItem(productId, variantId);
        return;
      }
      await wishlistService.remove(productId, variantId);
    },
    onMutate: async ({ productId, variantId }) => {
      if (!isCustomerSession) return undefined;

      await queryClient.cancelQueries({ queryKey: queryKey.wishlist });
      const previous = queryClient.getQueryData<WishlistResponseDto[]>(queryKey.wishlist);
      if (previous) {
        const exactVariantExists = variantId
          ? previous.some((item) => item.productId === productId && item.variantId === variantId)
          : false;
        queryClient.setQueryData<WishlistResponseDto[]>(
          queryKey.wishlist,
          previous.filter((item) =>
            item.productId !== productId ||
            (exactVariantExists && item.variantId !== variantId)
          )
        );
      }
      return { previous };
    },
    onSuccess: () => {
      toast.info("Removed from wishlist");
      void invalidateForYou();
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey.wishlist, context.previous);
      } else if (context && isCustomerSession) {
        queryClient.removeQueries({ queryKey: queryKey.wishlist, exact: true });
      }
      toast.error(
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "Unable to remove item"
      );
    },
    onSettled: (_data, _error, _variables, context) => {
      if (isCustomerSession && context?.previous === undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKey.wishlist });
      }
    },
  });

  // Toggle item mutation - simple and clean
  const toggleItemMutation = useMutation({
    mutationFn: async ({
      product,
      variantId,
      shouldAdd,
    }: {
      product: WishlistToggleProduct;
      variantId?: string;
      shouldAdd: boolean;
    }) => {
      // Handle guest users with local store
      if (!isCustomerSession) {
        useWishlistStore.getState().toggleItem(product, variantId);
        return null;
      }

      if (shouldAdd) {
        return (await wishlistService.add(product.id, variantId)).data;
      }
      await wishlistService.remove(product.id, variantId);
      return null;
    },
    onMutate: async ({ product, variantId, shouldAdd }) => {
      if (!isCustomerSession) return undefined;

      await queryClient.cancelQueries({ queryKey: queryKey.wishlist });
      const previous = queryClient.getQueryData<WishlistResponseDto[]>(queryKey.wishlist);
      const current = previous ?? [];
      const firstImage = product.images?.[0];
      const productImage = product.thumbnail ?? (
        typeof firstImage === "string" ? firstImage : firstImage?.url
      ) ?? null;

      const isTarget = (item: WishlistResponseDto) =>
        item.productId === product.id &&
        (!variantId || !item.variantId || item.variantId === variantId);

      const next = shouldAdd
        ? [
            ...current.filter((item) => item.productId !== product.id),
            {
              id: `optimistic:${product.id}:${variantId ?? "product"}`,
              productId: product.id,
              variantId: variantId ?? null,
              productName: product.name,
              productSlug: product.slug,
              productPrice: Number(product.price ?? 0),
              productImage,
              createdAt: new Date(),
            },
          ]
        : current.filter((item) => !isTarget(item));

      queryClient.setQueryData(queryKey.wishlist, next);
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey.wishlist, context.previous);
      } else if (context) {
        queryClient.removeQueries({ queryKey: queryKey.wishlist, exact: true });
      }
      toast.error(
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "Unable to update wishlist"
      );
    },
    onSuccess: (addedItem, variables, context) => {
      if (!isCustomerSession) return;
      void invalidateForYou();
      if (context?.previous === undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKey.wishlist });
        return;
      }
      if (variables.shouldAdd && addedItem) {
        queryClient.setQueryData<WishlistResponseDto[]>(
          queryKey.wishlist,
          (current) => current
            ? [addedItem, ...current.filter((item) => item.productId !== variables.product.id)]
            : current
        );
      }
    },
  });

  // Simple clear wishlist
  const clearWishlist = useCallback(async () => {
    if (!isCustomerSession) {
      useWishlistStore.getState().clearWishlist();
      return;
    }

    const itemsToRemove = serverItems ?? [];
    await Promise.all(
      itemsToRemove.map((item) =>
        wishlistService.remove(item.productId, item.variantId ?? undefined)
      )
    );
    queryClient.invalidateQueries({ queryKey: queryKey.wishlist });
    invalidateForYou();
  }, [isCustomerSession, serverItems, queryClient, invalidateForYou]);

  return {
    items,
    count: items.length,
    isLoading,
    isTogglePending: toggleItemMutation.isPending,
    isInWishlist,
    removeItem: (productId: string, variantId?: string) =>
      removeItemMutation.mutate({ productId, variantId }),
    toggleItem: (product: WishlistToggleProduct, variantId?: string) =>
      toggleItemMutation.mutateAsync({
        product,
        variantId,
        shouldAdd: !isInWishlist(product.id, variantId),
      }),
    clearWishlist,
  };
}
