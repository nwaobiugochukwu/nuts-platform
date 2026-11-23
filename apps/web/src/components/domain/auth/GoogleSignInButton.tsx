"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/util";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface GoogleCredentialResponse {
  credential: string;
  select_by?: string;
}

interface GoogleInitConfig {
  client_id: string;
  auto_select?: boolean;
  use_fedcm_for_button?: boolean;
  button_auto_select?: boolean;
  callback: (response: GoogleCredentialResponse) => void;
}

type GoogleButtonText = "signin_with" | "signup_with" | "continue_with";

interface GoogleButtonConfig {
  type: "standard";
  theme: "outline";
  size: "large";
  text?: GoogleButtonText;
  shape: "rectangular";
  width?: number;
  logo_alignment?: "left" | "center";
  click_listener?: () => void;
}

type GoogleCredentialHandler = (
  response: GoogleCredentialResponse,
) => void | Promise<void>;

interface GoogleIdentityState {
  scriptPromise: Promise<void> | null;
  initializePromise: Promise<void> | null;
  initializedClientId: string | null;
  activeCredentialHandler: GoogleCredentialHandler | null;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleInitConfig) => void;
          disableAutoSelect: () => void;
          prompt: (momentListener?: (moment: unknown) => void) => void;
          renderButton: (
            parent: HTMLElement,
            options: GoogleButtonConfig,
          ) => void;
        };
      };
    };
    __nutsGoogleIdentityState?: GoogleIdentityState;
  }
}

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GIS_SCRIPT_ID = "google-gis-script";

function getGoogleIdentityState(): GoogleIdentityState {
  if (typeof window === "undefined") {
    return {
      scriptPromise: null,
      initializePromise: null,
      initializedClientId: null,
      activeCredentialHandler: null,
    };
  }
  window.__nutsGoogleIdentityState ??= {
    scriptPromise: null,
    initializePromise: null,
    initializedClientId: null,
    activeCredentialHandler: null,
  };
  return window.__nutsGoogleIdentityState;
}

function loadGisScript(): Promise<void> {
  const state = getGoogleIdentityState();
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (state.scriptPromise) return state.scriptPromise;

  state.scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(
      GIS_SCRIPT_ID,
    ) as HTMLScriptElement | null;

    const script = existing ?? document.createElement("script");
    script.addEventListener(
      "load",
      () => {
        if (window.google?.accounts?.id) resolve();
        else reject(new Error("Google Identity Services did not initialize."));
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error("Google Identity Services failed to load.")),
      { once: true },
    );

    if (!existing) {
      script.id = GIS_SCRIPT_ID;
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    state.scriptPromise = null;
    throw error;
  });

  return state.scriptPromise;
}

async function initializeGisOnce(clientId: string): Promise<void> {
  const state = getGoogleIdentityState();

  if (state.initializedClientId) {
    if (state.initializedClientId !== clientId) {
      console.warn(
        "[Google Sign-In] Already initialized with a different client ID.",
      );
    }
    return;
  }

  if (!state.initializePromise) {
    state.initializePromise = (async () => {
      await loadGisScript();
      if (state.initializedClientId) return;

      const googleId = window.google?.accounts?.id;
      if (!googleId) {
        throw new Error("Google Identity Services is unavailable.");
      }

      googleId.initialize({
        client_id: clientId,
        auto_select: false,
        use_fedcm_for_button: false,
        button_auto_select: false,
        callback: (response) => {
          const handler = state.activeCredentialHandler;
          if (!handler) {
            console.error(
              "[Google Sign-In] Received credential without an active handler.",
            );
            return;
          }
          void handler(response);
        },
      });
      state.initializedClientId = clientId;
    })();
  }

  try {
    await state.initializePromise;
  } catch (error) {
    state.initializePromise = null;
    throw error;
  }
}

export function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        fill="#EA4335"
      />
    </svg>
  );
}

export interface GoogleSignInButtonProps {
  onSuccess: (idToken: string) => void | Promise<void>;
  onError?: (message: string) => void;
  mode?: "signin" | "signup" | "continue";
  className?: string;
  loading?: boolean;
  /** Blocks the Google button while a required form value is missing. */
  disabled?: boolean;
  /** Called when the disabled button is clicked. */
  onDisabledClick?: () => void;
}

/**
 * Production-grade Google Sign-In Button component.
 *
 * Design & Architecture:
 * - Always renders a high-fidelity, accessible branded button matching the design system
 *   (with official Google multi-color SVG icon and accurate copy).
 * - Never shows raw developer error strings (like "Google Sign-In is not configured") to users.
 * - If Google Client ID is configured, securely overlays the Google GIS iframe button
 *   so direct user gesture triggers the GIS authentication prompt without popup blockers.
 * - If Google Client ID is missing in staging or preview, clicking the button gracefully
 *   shows a user-friendly notification advising email sign-in.
 * - Completely avoids hydration mismatch (React #418) by maintaining identical SSR/client markup.
 */
export function GoogleSignInButton({
  onSuccess,
  onError,
  mode = "signin",
  className,
  loading = false,
  disabled = false,
  onDisabledClick,
}: GoogleSignInButtonProps) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const overlayContainerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef({ onSuccess, onError });
  const [isGisReady, setIsGisReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    callbackRef.current = { onSuccess, onError };
  }, [onSuccess, onError]);

  const buttonText: GoogleButtonText =
    mode === "signup"
      ? "signup_with"
      : mode === "continue"
        ? "continue_with"
        : "signin_with";

  const buttonLabel =
    mode === "signup"
      ? "Sign up with Google"
      : mode === "continue"
        ? "Continue with Google"
        : "Sign in with Google";

  // Mount Google Identity Services overlay when clientId is configured
  useEffect(() => {
    if (!clientId) return;
    let isMounted = true;
    const container = overlayContainerRef.current;

    const credentialHandler: GoogleCredentialHandler = async (response) => {
      if (!isMounted) return;
      setIsSigningIn(true);
      try {
        await callbackRef.current.onSuccess(response.credential);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Google sign-in could not be completed. Please try again.";
        callbackRef.current.onError?.(message);
      } finally {
        if (isMounted) setIsSigningIn(false);
      }
    };

    async function mountGisOverlay() {
      try {
        await initializeGisOnce(clientId as string);
        if (!isMounted || !overlayContainerRef.current) return;

        const googleId = window.google?.accounts?.id;
        if (!googleId) return;

        const overlay = overlayContainerRef.current;
        overlay.replaceChildren();

        // Render standard GIS button inside invisible overlay to capture native gesture
        googleId.renderButton(overlay, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: buttonText,
          shape: "rectangular",
          width: 380,
          click_listener: () => {
            getGoogleIdentityState().activeCredentialHandler = credentialHandler;
          },
        });

        setIsGisReady(true);
      } catch (error) {
        // Fallback gracefully — custom button remains visible and clickable
        console.warn("[Google Sign-In] GIS overlay initialization deferred:", error);
      }
    }

    void mountGisOverlay();

    return () => {
      isMounted = false;
      const state = getGoogleIdentityState();
      if (state.activeCredentialHandler === credentialHandler) {
        state.activeCredentialHandler = null;
      }
      if (container) {
        container.replaceChildren();
      }
    };
  }, [buttonText, clientId]);

  const isBusy = loading || isSigningIn;

  const handleClick = () => {
    if (disabled) {
      onDisabledClick?.();
      return;
    }

    if (isBusy) return;

    if (!clientId) {
      toast.info(
        "Google Sign-In is temporarily unavailable in this environment. Please sign in with email and password.",
      );
      callbackRef.current.onError?.("Google Sign-In is not configured.");
      return;
    }

    // If GIS hasn't rendered the overlay yet, try prompt directly
    if (window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
    } else {
      toast.info("Connecting to Google Services... Please try again in a moment.");
    }
  };

  return (
    <div className={cn("relative w-full select-none", className)}>
      {/* ── Visual Branded Button (Always visible on SSR and Client) ── */}
      <button
        type="button"
        disabled={isBusy}
        onClick={handleClick}
        aria-label={buttonLabel}
        className={cn(
          "flex h-11 w-full items-center justify-center gap-3 rounded-2xl border border-border/80 bg-background px-4 text-sm font-semibold text-foreground shadow-xs transition-all",
          "hover:bg-accent/60 active:scale-[0.99] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          disabled && "opacity-70 cursor-not-allowed hover:bg-background active:scale-100",
          isBusy && "cursor-wait opacity-80",
        )}
      >
        {isBusy ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <GoogleLogo className="shrink-0" />
        )}
        <span>{isBusy ? "Connecting to Google…" : buttonLabel}</span>
      </button>

      {/* ── Transparent GIS Overlay (Captures native click when configured & ready) ── */}
      {clientId && (
        <div
          ref={overlayContainerRef}
          aria-hidden="true"
          className={cn(
            "absolute inset-0 z-10 flex items-center justify-center overflow-hidden rounded-2xl opacity-[0.0001]",
            (!isGisReady || isBusy || disabled) ? "pointer-events-none" : "pointer-events-auto cursor-pointer",
          )}
        />
      )}

      {/* ── Disabled Click Interceptor (Triggers validation message when disabled) ── */}
      {disabled && !isBusy && onDisabledClick && (
        <div
          role="button"
          tabIndex={-1}
          aria-label={`${buttonLabel}; please complete the required fields first`}
          onClick={onDisabledClick}
          className="absolute inset-0 z-20 cursor-not-allowed rounded-2xl bg-transparent"
        />
      )}
    </div>
  );
}
