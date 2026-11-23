import { create } from "zustand";
import { toast } from "sonner";

export interface AppliedDiscount {
  code: string;
  /** What this voucher takes off the current cart. */
  amount: number;
  scope?: "VENDOR" | "PLATFORM";
}

interface StoredClaims {
  codes: string[];
  claimedAt: number;
  /** null = claimed as a guest (not yet bound to an account). */
  ownerId: string | null;
}

const STORAGE_KEY = "nuts.claimed-vouchers.v2";
/** A local claim is a convenience, not an entitlement: it expires after a day. */
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
/** One store voucher + one platform voucher can be combined, so hold two. */
export const MAX_CLAIMED_VOUCHERS = 2;

function readClaims(): StoredClaims | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredClaims>;
    if (
      !Array.isArray(parsed.codes) ||
      typeof parsed.claimedAt !== "number" ||
      Date.now() - parsed.claimedAt > CLAIM_TTL_MS
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const codes = parsed.codes.filter((c): c is string => typeof c === "string");
    if (codes.length === 0) return null;
    return {
      codes: codes.slice(-MAX_CLAIMED_VOUCHERS),
      claimedAt: parsed.claimedAt,
      ownerId: typeof parsed.ownerId === "string" ? parsed.ownerId : null,
    };
  } catch {
    return null;
  }
}

function writeClaims(claims: StoredClaims | null): void {
  if (typeof window === "undefined") return;
  try {
    if (claims && claims.codes.length > 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(claims));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage blocked: the claims still work for this page view.
  }
}

const normalize = (code: string) => code.trim().toUpperCase();

/** Newest last; a re-claimed code moves to the end; only the newest N are kept. */
function withClaim(codes: string[], code: string): string[] {
  return [...codes.filter((c) => c !== code), code].slice(-MAX_CLAIMED_VOUCHERS);
}

interface DiscountStore {
  /** Server-confirmed discounts for the current cart (in memory only). */
  appliedDiscounts: AppliedDiscount[];
  /** Vouchers the shopper picked (newest last); survive refresh and the login redirect. */
  claimedCodes: string[];
  /**
   * Account the store currently belongs to: a user id, null for a guest, or
   * undefined while auth has not resolved yet (nothing is judged until then).
   */
  identityId: string | null | undefined;

  setAppliedDiscounts: (discounts: AppliedDiscount[]) => void;
  /** Local claim (add/refresh). Server reservation is handled by useClaimVoucher. */
  claimCode: (code: string, options?: { silent?: boolean; copy?: boolean }) => void;
  /** Replace the claim list (e.g. reconciled with the server's wallet). */
  setClaims: (codes: string[]) => void;
  /** Forget ONE claimed voucher (and its applied discount). */
  removeClaim: (code: string) => void;
  /** Forget only the applied amounts (cart no longer qualifies); keep the claims. */
  clearApplied: () => void;
  /** Forget everything (order placed, explicit removal). */
  clearDiscount: () => void;
  /** Load persisted claims after hydration (identity is resolved later by syncIdentity). */
  hydrate: () => void;
  /** Call whenever the signed-in account changes (login, logout, switch). */
  syncIdentity: (identityId: string | null) => void;
}

/**
 * Voucher claim state.
 *
 * Identity rules (so claims neither get lost nor leak between people):
 *  - Claims made as a GUEST are adopted by whoever signs in next, so
 *    "claim, then log in" works, including across the login page redirect.
 *  - Claims owned by an account are dropped on logout and when a DIFFERENT
 *    account signs in, so one person's vouchers never show for another.
 *  - Local claims expire after 24h. A signed-in customer's real wallet lives on
 *    the server (reservations included) and is reconciled into this store.
 * Applied amounts are never persisted; they are re-derived from the server.
 */
export const useDiscountStore = create<DiscountStore>((set, get) => ({
  appliedDiscounts: [],
  claimedCodes: [],
  identityId: undefined,

  setAppliedDiscounts: (discounts) => set({ appliedDiscounts: discounts }),

  claimCode: (rawCode, options) => {
    const code = normalize(rawCode);
    if (!code) return;

    const codes = withClaim(get().claimedCodes, code);
    writeClaims({
      codes,
      claimedAt: Date.now(),
      ownerId: get().identityId ?? null,
    });
    set({ claimedCodes: codes });

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

  setClaims: (rawCodes) => {
    const codes = [...new Set(rawCodes.map(normalize).filter(Boolean))].slice(
      -MAX_CLAIMED_VOUCHERS,
    );
    writeClaims(
      codes.length > 0
        ? { codes, claimedAt: Date.now(), ownerId: get().identityId ?? null }
        : null,
    );
    set((state) => ({
      claimedCodes: codes,
      appliedDiscounts: state.appliedDiscounts.filter((d) =>
        codes.includes(d.code),
      ),
    }));
  },

  removeClaim: (rawCode) => {
    const code = normalize(rawCode);
    const codes = get().claimedCodes.filter((c) => c !== code);
    writeClaims(
      codes.length > 0
        ? { codes, claimedAt: Date.now(), ownerId: get().identityId ?? null }
        : null,
    );
    set((state) => ({
      claimedCodes: codes,
      appliedDiscounts: state.appliedDiscounts.filter((d) => d.code !== code),
    }));
  },

  clearApplied: () => set({ appliedDiscounts: [] }),

  clearDiscount: () => {
    writeClaims(null);
    set({ appliedDiscounts: [], claimedCodes: [] });
  },

  hydrate: () => {
    // Auth has usually not resolved yet, so ownership is NOT judged here (that
    // would wrongly drop an account's claims on every page load). Show what is
    // stored; syncIdentity() applies the ownership rules once the account is
    // known.
    const stored = readClaims();
    set({ claimedCodes: stored?.codes ?? [] });

    // Keep other tabs in step (claim, release, logout).
    if (typeof window !== "undefined" && !crossTabBound) {
      crossTabBound = true;
      window.addEventListener("storage", (event) => {
        if (event.key !== STORAGE_KEY) return;
        const next = readClaims();
        const current = get();
        if (
          next &&
          next.ownerId !== null &&
          current.identityId !== undefined &&
          next.ownerId !== current.identityId
        ) {
          return;
        }
        const codes = next?.codes ?? [];
        set({
          claimedCodes: codes,
          appliedDiscounts: current.appliedDiscounts.filter((d) =>
            codes.includes(d.code),
          ),
        });
      });
    }
  },

  syncIdentity: (identityId) => {
    const previous = get().identityId;
    if (previous === identityId) return;
    set({ identityId, appliedDiscounts: [] });

    const dropClaims = () => {
      writeClaims(null);
      set({ claimedCodes: [] });
    };

    // Leaving an account (logout, or a different account signing in): whatever
    // was claimed belonged to the account that is gone.
    if (previous && previous !== identityId) {
      dropClaims();
      return;
    }

    // From here the store was unresolved (page load) or a guest.
    const stored = readClaims();
    // Nothing persisted (e.g. storage blocked): keep the in-memory claims.
    if (!stored) return;

    if (identityId === null) {
      // Resolved as a guest: an account-owned leftover (expired session) is
      // not theirs to use.
      if (stored.ownerId !== null) dropClaims();
      return;
    }
    if (stored.ownerId === null) {
      // A guest's claims are adopted by the account that just signed in.
      writeClaims({ ...stored, ownerId: identityId });
      set({ claimedCodes: stored.codes });
    } else if (stored.ownerId !== identityId) {
      dropClaims();
    }
  },
}));

let crossTabBound = false;
