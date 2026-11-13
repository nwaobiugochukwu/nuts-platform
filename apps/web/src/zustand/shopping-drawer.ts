import { create } from "zustand";

export type ShoppingPanel = "cart" | "wishlist" | "checkout" | "order-success" | null;

interface ShoppingDrawerState {
  panel: ShoppingPanel;
  completedOrderId: string | null;
  open: (panel: Exclude<ShoppingPanel, null>) => void;
  close: () => void;
  completeOrder: (orderId: string) => void;
}

export const useShoppingDrawerStore = create<ShoppingDrawerState>((set) => ({
  panel: null,
  completedOrderId: null,
  open: (panel) => set({ panel }),
  close: () => set({ panel: null }),
  completeOrder: (completedOrderId) => set({ panel: "order-success", completedOrderId }),
}));
