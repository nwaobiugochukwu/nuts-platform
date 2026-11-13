"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/util";

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
  type: "icon";
  theme: "outline";
  size: "medium";
  text: GoogleButtonText;
  shape: "circle";
  click_listener: () => void;
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
      throw new Error(
        "Google Identity Services was already initialized with a different client ID.",
      );
    }
    return;
  }

  if (!state.initializePromise) {
    state.initializePromise = (async () => {
      await loadGisScript();
      if (state.initializedClientId) {
        if (state.initializedClientId !== clientId) {
          throw new Error(
            "Google Identity Services was already initialized with a different client ID.",
          );
        }
        return;
      }

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
              "[Google Sign-In] Received a credential without an active sign-in button.",
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
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef({ onSuccess, onError });
  const [isGisReady, setIsGisReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = { onSuccess, onError };
  }, [onSuccess, onError]);

  const buttonText: GoogleButtonText =
    mode === "signup"
      ? "signup_with"
      : mode === "continue"
        ? "continue_with"
        : "signin_with";

  const unconfiguredError = !clientId ? "Google Sign-In is not configured." : null;
  const displayedError = errorMessage ?? unconfiguredError;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !clientId) return;
    const configuredClientId = clientId;

    let isMounted = true;
    setIsGisReady(false);
    setErrorMessage(null);

    const credentialHandler: GoogleCredentialHandler = async (response) => {
      if (!isMounted) return;
      setIsSigningIn(true);
      try {
        await callbackRef.current.onSuccess(response.credential);
      } catch {
        const message = "Google sign-in could not be completed. Please try again.";
        setErrorMessage(message);
        callbackRef.current.onError?.(message);
      } finally {
        setIsSigningIn(false);
      }
    };

    async function mountGoogleButton() {
      try {
        await initializeGisOnce(configuredClientId);
        if (!isMounted || !containerRef.current) return;

        const googleId = window.google?.accounts?.id;
        if (!googleId) throw new Error("Google Identity Services is unavailable.");

        const buttonContainer = containerRef.current;
        buttonContainer.replaceChildren();

        googleId.renderButton(buttonContainer, {
          type: "icon",
          theme: "outline",
          size: "medium",
          text: buttonText,
          shape: "circle",
          click_listener: () => {
            getGoogleIdentityState().activeCredentialHandler = credentialHandler;
            if (process.env.NODE_ENV === "development") {
              console.info(
                `[Google Sign-In] origin=${window.location.origin} client_id=${configuredClientId}`,
              );
            }
          },
        });

        setIsGisReady(true);
      } catch (error) {
        if (!isMounted) return;
        const message = "Google Sign-In could not load. Please try again.";
        setErrorMessage(message);
        callbackRef.current.onError?.(message);
        console.error("[Google Sign-In] Failed to initialize button.", error);
      }
    }

    void mountGoogleButton();

    return () => {
      isMounted = false;
      const state = getGoogleIdentityState();
      if (state.activeCredentialHandler === credentialHandler) {
        state.activeCredentialHandler = null;
      }
      container.replaceChildren();
    };
  }, [buttonText, clientId]);

  const isBusy = loading || isSigningIn;
  const isInteractionBlocked = disabled || isBusy || !clientId || !isGisReady;
  const buttonLabel =
    mode === "signup"
      ? "Sign up with Google"
      : mode === "continue"
        ? "Continue with Google"
        : "Sign in with Google";

  return (
    <div className={cn("relative min-h-11 w-full", className)}>
      <div
        ref={containerRef}
        className={cn(
          "flex min-h-11 w-full items-center justify-center",
          !isGisReady && "invisible",
        )}
        inert={isInteractionBlocked}
      />

      {disabled && isGisReady && !isBusy && onDisabledClick && (
        <button
          type="button"
          aria-label={`${buttonLabel}; complete the required field first`}
          className="absolute inset-0 z-10 cursor-not-allowed rounded-full bg-transparent"
          onClick={onDisabledClick}
        />
      )}

      {displayedError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {displayedError}
        </p>
      )}
    </div>
  );
}
