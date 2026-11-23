import { create } from "zustand";
import { toast } from "sonner";

export interface AppliedDiscount {
  code: string;
  amount: number;
}

interface StoredClaim {
  code: string;
  claimedAt: number;
  /** null = claimed as a guest (not yet bound to an account). */
  ownerId: string | null;
}

const STORAGE_KEY = "nuts.claimed-voucher.v1";
/** A claim is a convenience, not an entitlement: it expires after a day. */
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

function readClaim(): StoredClaim | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredClaim>;
    if (
      typeof parsed.code !== "string" ||
      typeof parsed.claimedAt !== "number" ||
      Date.now() - parsed.claimedAt > CLAIM_TTL_MS
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      code: parsed.code,
      claimedAt: parsed.claimedAt,
      ownerId: typeof parsed.ownerId === "string" ? parsed.ownerId : null,
    };
  } catch {
    return null;
  }
}

function writeClaim(claim: StoredClaim | null): void {
  if (typeof window === "undefined") return;
  try {
    if (claim) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(claim));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the claim still works for this page view.
  }
}

interface DiscountStore {
  /** Last server-confirmed discount for the current cart (in memory only). */
  appliedDiscount: AppliedDiscount | null;
  /** Voucher the shopper picked; survives refresh and the login redirect. */
  claimedCode: string | null;
  /**
   * Account the store currently belongs to: a user id, null for a guest, or
   * undefined while auth has not resolved yet (nothing is judged until then).
   */
  identityId: string | null | undefined;
  setAppliedDiscount: (discount: AppliedDiscount | null) => void;
  claimCode: (code: string, options?: { silent?: boolean; copy?: boolean }) => void;
  /** Forget only the applied amount (e.g. cart no longer qualifies); keep the claim. */
  clearApplied: () => void;
  /** Forget the claim too (explicit removal, order placed, voucher invalid). */
  clearDiscount: () => void;
  /** Load the persisted claim after hydration (identity is resolved later by syncIdentity). */
  hydrate: () => void;
  /** Call whenever the signed-in account changes (login, logout, switch). */
  syncIdentity: (identityId: string | null) => void;
}

/**
 * Voucher claim state.
 *
 * Identity rules (so claims neither get lost nor leak between people):
 *  - A claim made as a GUEST is adopted by whoever signs in next, so
 *    "claim, then log in" works, including across the login page redirect.
 *  - A claim owned by an account is dropped on logout and when a DIFFERENT
 *    account signs in, so one person's voucher never shows for another.
 *  - Claims expire after 24h.
 * The applied amount is never persisted; it is re-derived from the server.
 */
export const useDiscountStore = create<DiscountStore>((set, get) => ({
  appliedDiscount: null,
  claimedCode: null,
  identityId: undefined,

  setAppliedDiscount: (discount) => set({ appliedDiscount: discount }),

  claimCode: (rawCode, options) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;

    const previous = get().claimedCode;
    writeClaim({ code, claimedAt: Date.now(), ownerId: get().identityId ?? null });
    set({
      claimedCode: code,
      // Claiming a different voucher replaces whatever was applied, so the
      // newly chosen one is evaluated instead of silently ignored.
      appliedDiscount:
        previous && previous !== code ? null : get().appliedDiscount,
    });

    const announce = (copied: boolean) => {
      if (options?.silent) return;
      toast.success(
        copied
          ? `Voucher "${code}" claimed! Code copied to clipboard.`
          : `Voucher "${code}" claimed!`,
      );
    };

    if (
      options?.copy !== false &&
      typeof navigator !== "undefined" &&
      navigator.clipboard
    ) {
      navigator.clipboard.writeText(code).then(
        () => announce(true),
        () => announce(false),
      );
    } else {
      announce(false);
    }
  },

  clearApplied: () => set({ appliedDiscount: null }),

  clearDiscount: () => {
    writeClaim(null);
    set({ appliedDiscount: null, claimedCode: null });
  },

  hydrate: () => {
    // Auth has usually not resolved yet, so ownership is NOT judged here (that
    // would wrongly drop an account's claim on every page load). Show the
    // stored claim; syncIdentity() applies the ownership rules once the
    // account is known.
    const stored = readClaim();
    set({ claimedCode: stored?.code ?? null });

    // Keep other tabs in step (claim, release, logout).
    if (typeof window !== "undefined" && !crossTabBound) {
      crossTabBound = true;
      window.addEventListener("storage", (event) => {
        if (event.key !== STORAGE_KEY) return;
        const next = readClaim();
        const current = get();
        if (
          next &&
          next.ownerId !== null &&
          current.identityId !== undefined &&
          next.ownerId !== current.identityId
        ) {
          return;
        }
        set({
          claimedCode: next?.code ?? null,
          appliedDiscount:
            next?.code === current.appliedDiscount?.code
              ? current.appliedDiscount
              : null,
        });
      });
    }
  },

  syncIdentity: (identityId) => {
    const previous = get().identityId;
    if (previous === identityId) return;
    set({ identityId, appliedDiscount: null });

    const dropClaim = () => {
      writeClaim(null);
      set({ claimedCode: null });
    };

    // Leaving an account (logout, or a different account signing in): whatever
    // was claimed belonged to the account that is gone.
    if (previous && previous !== identityId) {
      dropClaim();
      return;
    }

    // From here the store was unresolved (page load) or a guest.
    const stored = readClaim();
    // Nothing persisted (e.g. storage blocked): keep the in-memory claim.
    if (!stored) return;

    if (identityId === null) {
      // Resolved as a guest: an account-owned leftover (expired session) is
      // not theirs to use.
      if (stored.ownerId !== null) dropClaim();
      return;
    }
    if (stored.ownerId === null) {
      // A guest's claim is adopted by the account that just signed in.
      writeClaim({ ...stored, ownerId: identityId });
      set({ claimedCode: stored.code });
    } else if (stored.ownerId !== identityId) {
      dropClaim();
    }
  },
}));

let crossTabBound = false;
