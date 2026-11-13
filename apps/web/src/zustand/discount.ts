import { create } from "zustand";

export interface AppliedDiscount {
  code: string;
  amount: number;
}

interface DiscountStore {
  appliedDiscount: AppliedDiscount | null;
  setAppliedDiscount: (discount: AppliedDiscount | null) => void;
  clearDiscount: () => void;
}

/**
 * Pure in-memory discount store.
 *
 * Keeps active promotional discount codes transiently in memory across
 * the Cart Page, Shopping Drawer, and Checkout during an active session,
 * completely immune to localStorage pollution or cross-session leakage.
 */
export const useDiscountStore = create<DiscountStore>((set) => ({
  appliedDiscount: null,
  setAppliedDiscount: (discount) => set({ appliedDiscount: discount }),
  clearDiscount: () => set({ appliedDiscount: null }),
}));
