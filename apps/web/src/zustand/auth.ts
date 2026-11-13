import {
  adminAuthService,
  authService,
  vendorAuthService,
} from "@/api";
import {
  AuthRefreshUnavailableError,
  performTokenRefresh,
} from "@/api/core/client";
import {
  type StoredTokens,
  clearAuthTokens,
  getAuthSessionRole,
  getAuthToken,
  getRefreshToken,
  markSessionAuthenticated,
  markSessionUnauthenticated,
  setAuthTokens,
} from "@/api/core/token-storage";
import type { AuthRole, AuthResponseDto, AdminAuthResponseDto } from "@/api/dto/auth";
import type { VendorAuthSessionDto } from "@/api/dto/vendor";
import type { ShippingInformation, UserResponseDto } from "@/api/dto/user";
import axios from "axios";
import { authBroadcast, type AuthEvent } from "@/lib/auth-events";
import { clearBrowserQueryClient } from "@/lib/query-client";
import {
  rotateRecommendationSessionId,
  rotateRecommendationVisitorId,
} from "@/lib/recommendation-session";
import { safeInternalPath } from "@/lib/safe-internal-path";
import { create } from "zustand";
import { clearWishlistOnLogout } from "./wishlist";

export type AuthStatus =
  | "unknown"
  | "hydrating"
  | "authenticated"
  | "unauthenticated"
  | "unavailable";

export type UserCapabilities = {
  canPurchase: boolean;
  canSell: boolean;
  canAdminister: boolean;
};

export type User = {
  id: string;
  email: string;
  role: AuthRole;
  capabilities: UserCapabilities;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  phoneNumber?: string | null;
  avatar?: string;
  storeName?: string;
  storeSlug?: string;
  storeLogoUrl?: string | null;
  isEmailVerified?: boolean;
  isVerified?: boolean;
  isActive?: boolean;
  isApproved?: boolean;
  shippingInformation?: ShippingInformation | null;
  referralCode?: string | null;
  createdAt?: Date | string;
};

export function deriveCapabilities(
  role: AuthRole,
  isActive = true,
  isApproved = true,
): UserCapabilities {
  switch (role) {
    case "user":
      return { canPurchase: isActive, canSell: false, canAdminister: false };
    case "vendor":
      return { canPurchase: false, canSell: isActive && isApproved, canAdminister: false };
    case "admin":
      return { canPurchase: false, canSell: false, canAdminister: isActive };
  }
}

export type SessionUserInput = Partial<User> & {
  id: string;
  email: string;
};

export { getAuthToken, getRefreshToken, setAuthTokens };
export type { AuthRole, ShippingInformation, StoredTokens };

export const normalizeRole = (role?: string | null): AuthRole | null => {
  if (!role) return null;
  const normalized = role.toLowerCase();
  if (
    normalized === "user" ||
    normalized === "admin" ||
    normalized === "vendor"
  ) {
    return normalized as AuthRole;
  }
  return null;
};

export interface LogoutOptions {
  skipApi?: boolean;
  redirectTo?: string;
}

export type GoogleAuthIntent = "login" | "signup";

interface LoginPayload {
  email: string;
  password: string;
  role: AuthRole;
}

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  role: AuthRole | null;
  capabilities: UserCapabilities | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;

  // Actions
  setSession: (user: SessionUserInput, role?: AuthRole) => void;
  clearSession: () => void;
  setStatus: (status: AuthStatus) => void;
  setUser: (user: User | UserResponseDto | null) => void;

  // Auth Operations
  login: (payload: LoginPayload) => Promise<void>;
  googleAuthenticate: (
    idToken: string,
    role: 'user' | 'vendor',
    intent: GoogleAuthIntent,
    options?: {
      referralCode?: string;
      storeName?: string;
      storeDescription?: string;
      businessPhone?: string;
    },
  ) => Promise<void>;
  logout: (options?: LogoutOptions & { role?: AuthRole }) => Promise<void>;
  hydrateRole: (role: AuthRole) => void;
  hydrateFromCookies: () => Promise<void>;
  fetchUser: () => Promise<void>;
}

let pendingHydrationPromise: Promise<void> | null = null;
let broadcastSubscribed = false;

function disableGoogleAutoSelectOnSignOut(): void {
  if (typeof window === "undefined") return;

  const googleId = (
    window as Window & {
      google?: {
        accounts?: {
          id?: { disableAutoSelect?: () => void };
        };
      };
    }
  ).google?.accounts?.id;

  try {
    googleId?.disableAutoSelect?.();
  } catch {
    // Google UI state must never prevent the app session from being cleared.
  }
}

export const resetAuthBootstrap = () => {
  pendingHydrationPromise = null;
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: "unknown",
  user: null,
  role: null,
  capabilities: null,
  isAuthenticated: false,
  isLoading: true,
  isInitialized: false,

  setStatus: (status) => {
    set((state) => ({
      status,
      isLoading: status === "unknown" || status === "hydrating",
      isInitialized: status !== "unknown" && status !== "hydrating",
      isAuthenticated:
        status === "authenticated" ||
        (status === "unavailable" && Boolean(state.user)),
    }));
  },

  setSession: (rawUser, role) => {
    const userRole = normalizeRole(role) || normalizeRole(rawUser.role) || get().role;
    if (!userRole) {
      get().clearSession();
      return;
    }

    const currentUser = get().user;
    if (currentUser && (currentUser.id !== rawUser.id || currentUser.role !== userRole)) {
      rotateRecommendationSessionId();
      rotateRecommendationVisitorId();
    }

    markSessionAuthenticated(userRole);

    const capabilities =
      rawUser.capabilities ??
      deriveCapabilities(
        userRole,
        rawUser.isActive ?? true,
        rawUser.isApproved ?? true,
      );

    const user: User = {
      ...rawUser,
      role: userRole,
      capabilities,
    };

    set({
      user,
      role: userRole,
      capabilities,
      isAuthenticated: true,
      status: "authenticated",
      isLoading: false,
      isInitialized: true,
    });
  },

  clearSession: () => {
    if (get().role === "user") {
      rotateRecommendationSessionId();
      rotateRecommendationVisitorId();
    }
    clearAuthTokens();
    markSessionUnauthenticated();
    set({
      user: null,
      role: null,
      capabilities: null,
      isAuthenticated: false,
      status: "unauthenticated",
      isLoading: false,
      isInitialized: true,
    });
  },

  login: async (payload) => {
    set({ status: "hydrating", isLoading: true, isInitialized: false });
    try {
      const { email, password, role } = payload;
      let responseData: AuthResponseDto | VendorAuthSessionDto | AdminAuthResponseDto;

      switch (role) {
        case "admin":
          responseData = (await adminAuthService.login({ email, password })).data;
          break;
        case "vendor":
          responseData = (await vendorAuthService.login({ email, password })).data;
          break;
        case "user":
        default:
          responseData = (await authService.login({ email, password })).data;
          break;
      }

      if (responseData?.accessToken) {
        clearAuthTokens();
        setAuthTokens(role, { accessToken: responseData.accessToken });
      }

      resetAuthBootstrap();

      const rawUser =
        "vendor" in responseData
          ? responseData.vendor
          : "admin" in responseData
            ? responseData.admin
            : responseData.user;
      if (!rawUser) {
        throw new Error("Authentication response did not include a user profile");
      }

      clearBrowserQueryClient();
      get().setSession(rawUser, role);

      authBroadcast.publish({ type: "LOGIN", role });
    } catch (err) {
      set({
        status: "unauthenticated",
        isLoading: false,
        isInitialized: true,
      });
      throw err;
    }
  },

  googleAuthenticate: async (idToken, role, intent, options) => {
    set({ status: 'hydrating', isLoading: true, isInitialized: false });
    try {
      let responseData: AuthResponseDto | VendorAuthSessionDto;
      if (role === 'vendor') {
        responseData = (
          intent === 'signup'
            ? await vendorAuthService.googleRegister({
                idToken,
                storeName: options?.storeName,
                storeDescription: options?.storeDescription,
                businessPhone: options?.businessPhone,
              })
            : await vendorAuthService.googleLogin({ idToken })
        ).data;
      } else {
        responseData = (
          intent === 'signup'
            ? await authService.googleRegister({
                idToken,
                referralCode: options?.referralCode,
              })
            : await authService.googleLogin({ idToken })
        ).data;
      }

      const rawUser =
        'vendor' in responseData ? responseData.vendor : responseData.user;
      if (!rawUser) {
        throw new Error('Google authentication response did not include a user profile');
      }

      if (role === 'vendor' && !responseData.accessToken) {
        set({ status: 'unauthenticated', isLoading: false, isInitialized: true });
        const err = Object.assign(
          new Error(
            'Vendor account is under review and awaiting administrative approval.',
          ),
          { isPendingApproval: true as const, vendor: rawUser },
        );
        throw err;
      }

      if (responseData?.accessToken) {
        clearAuthTokens();
        setAuthTokens(role, { accessToken: responseData.accessToken });
      }

      resetAuthBootstrap();

      clearBrowserQueryClient();
      get().setSession(rawUser, role);
      authBroadcast.publish({ type: 'LOGIN', role });
    } catch (err) {
      set({ status: 'unauthenticated', isLoading: false, isInitialized: true });
      throw err;
    }
  },
  logout: async (options) => {
    const currentRole = options?.role || get().role || "user";
    const skipApi = options?.skipApi ?? false;

    if (!skipApi) {
      try {
        if (currentRole === "admin") {
          await adminAuthService.logout();
        } else if (currentRole === "vendor") {
          await vendorAuthService.logout();
        } else {
          await authService.logout();
        }
      } catch (error) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        if (status !== 401) {
          throw new Error(
            "Could not confirm sign out. Your session is still active; please try again.",
            { cause: error },
          );
        }
      }
    }

    disableGoogleAutoSelectOnSignOut();
    clearAuthTokens();
    resetAuthBootstrap();
    if (currentRole === "user") {
      clearWishlistOnLogout();
    }

    clearBrowserQueryClient();

    get().clearSession();
    authBroadcast.publish({ type: "LOGOUT", role: currentRole });

    if (typeof window !== "undefined" && options?.redirectTo) {
      window.location.assign(safeInternalPath(options.redirectTo, "/"));
    }
  },

  hydrateRole: (role) => {
    const normalized = normalizeRole(role);
    if (!normalized) {
      get().clearSession();
      return;
    }
    markSessionAuthenticated(normalized);
    const capabilities = deriveCapabilities(normalized);
    set((state) => {
      const user = state.user
        ? { ...state.user, role: normalized, capabilities }
        : null;
      return {
        user,
        role: normalized,
        capabilities,
        isAuthenticated: true,
        status: "authenticated",
        isInitialized: true,
        isLoading: false,
      };
    });
  },

  hydrateFromCookies: async () => {
    if (typeof window === "undefined") return;

    // Initialize cross-tab synchronization listener once
    if (!broadcastSubscribed) {
      broadcastSubscribed = true;
      authBroadcast.subscribe((event: AuthEvent) => {
        if (event.type === "LOGOUT" || event.type === "SESSION_EXPIRED") {
          clearBrowserQueryClient();
          clearAuthTokens();
          resetAuthBootstrap();
          get().clearSession();
        } else if (event.type === "LOGIN") {
          clearBrowserQueryClient();
          resetAuthBootstrap();
          void get().hydrateFromCookies();
        } else if (
          event.type === "SESSION_REFRESHED" &&
          event.user &&
          typeof event.user === "object"
        ) {
          get().setSession(event.user as SessionUserInput, event.role as AuthRole);
        }
      });
    }

    const current = get();
    if (current.isAuthenticated && current.user) {
      return;
    }

    if (pendingHydrationPromise) {
      return pendingHydrationPromise;
    }

    pendingHydrationPromise = (async () => {
      if (!get().user) {
        get().setStatus("hydrating");
      }

      // 1. Identify active session role from in-memory token state or URL path (strictly no storage leaks)
      const pathHint: AuthRole | null =
        typeof window !== "undefined"
          ? window.location.pathname.startsWith("/admin")
            ? "admin"
            : window.location.pathname.startsWith("/vendor")
              ? "vendor"
              : null
          : null;

      const candidateRole: AuthRole =
        get().role || getAuthSessionRole() || pathHint || "user";

      // 2. Refresh tokens using HttpOnly refresh_token cookie (re-populates in-memory access token)
      try {
        let refreshResult = await performTokenRefresh(candidateRole);

        // Resilience: If candidate role was vendor/admin and failed (e.g. 401/403 due to role mismatch),
        // try the universal /auth/refresh endpoint before assuming the entire session is dead
        if (
          !refreshResult.success &&
          candidateRole !== "user" &&
          refreshResult.reason !== "unavailable"
        ) {
          const fallbackResult = await performTokenRefresh("user");
          if (fallbackResult.success) {
            refreshResult = fallbackResult;
          }
        }

        if (refreshResult.success && refreshResult.user) {
          const resolvedRole = refreshResult.role || candidateRole;
          get().setSession(
            refreshResult.user as SessionUserInput,
            resolvedRole,
          );
          return;
        }

        if (refreshResult.reason === "expired") {
          get().clearSession();
          return;
        }

        if (refreshResult.reason === "unavailable") {
          get().setStatus("unavailable");
          return;
        }

        get().clearSession();
      } catch (err) {
        if (err instanceof AuthRefreshUnavailableError) {
          get().setStatus("unavailable");
          return;
        }
        get().clearSession();
      }
    })();

    try {
      await pendingHydrationPromise;
    } finally {
      pendingHydrationPromise = null;
    }
  },

  setUser: (user) => {
    if (!user) {
      get().clearSession();
      return;
    }
    const role = normalizeRole((user as User).role) || get().role;
    if (role) {
      get().setSession(user, role);
    }
  },

  fetchUser: async () => {
    await get().hydrateFromCookies();
  },
}));
