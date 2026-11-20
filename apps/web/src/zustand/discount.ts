import { create } from "zustand";
import { toast } from "sonner";

export interface AppliedDiscount {
  code: string;
  amount: number;
}

interface DiscountStore {
  appliedDiscount: AppliedDiscount | null;
  claimedCode: string | null;
  setAppliedDiscount: (discount: AppliedDiscount | null) => void;
  setClaimedCode: (code: string | null) => void;
  claimCode: (code: string, options?: { silent?: boolean; copy?: boolean }) => void;
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
  claimedCode: null,
  setAppliedDiscount: (discount) => set({ appliedDiscount: discount }),
  setClaimedCode: (code) => set({ claimedCode: code }),
  claimCode: (rawCode: string, options) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;

    set({ claimedCode: code });

    if (options?.copy !== false && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {
        // clipboard write failed silently
      });
    }

    if (!options?.silent) {
      toast.success(`Voucher "${code}" claimed! Code copied to clipboard.`);
    }
  },
  clearDiscount: () => set({ appliedDiscount: null, claimedCode: null }),
}));
