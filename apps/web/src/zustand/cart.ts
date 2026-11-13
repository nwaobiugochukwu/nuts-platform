import { create } from 'zustand';

export interface OptimisticCartItem {
  productId: string;
  variantId?: string;
  quantity: number;
  product?: {
    id: string;
    title: string;
    basePrice: number;
    primaryImage?: {
      url: string;
    } | null;
  };
  variant?: {
    id: string;
    sku: string;
    price: number;
    compareAtPrice?: number | null;
  } | null;
}

export interface CartState {
  optimisticItems: OptimisticCartItem[];
  isDrawerOpen: boolean;
  isSyncing: boolean;
  setDrawerOpen: (open: boolean) => void;
  setOptimisticItems: (items: OptimisticCartItem[]) => void;
  addOptimisticItem: (item: OptimisticCartItem) => void;
  removeOptimisticItem: (productId: string, variantId?: string) => void;
  setSyncing: (syncing: boolean) => void;
  clearOptimisticCart: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  optimisticItems: [],
  isDrawerOpen: false,
  isSyncing: false,
  setDrawerOpen: (open) => set({ isDrawerOpen: open }),
  setOptimisticItems: (items) => set({ optimisticItems: items }),
  addOptimisticItem: (item) =>
    set((state) => {
      const existingIndex = state.optimisticItems.findIndex(
        (i) => i.productId === item.productId && i.variantId === item.variantId
      );
      if (existingIndex > -1) {
        const next = [...state.optimisticItems];
        const existing = next[existingIndex];
        if (existing) {
          next[existingIndex] = {
            ...existing,
            quantity: existing.quantity + item.quantity,
          };
        }
        return { optimisticItems: next };
      }
      return { optimisticItems: [...state.optimisticItems, item] };
    }),
  removeOptimisticItem: (productId, variantId) =>
    set((state) => ({
      optimisticItems: state.optimisticItems.filter(
        (i) => !(i.productId === productId && i.variantId === variantId)
      ),
    })),
  setSyncing: (syncing) => set({ isSyncing: syncing }),
  clearOptimisticCart: () => set({ optimisticItems: [] }),
}));
