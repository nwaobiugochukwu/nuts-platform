"use client";

import { useEffect, useState } from "react";

interface NutsLoadingScreenProps {
  /**
   * Whether to render as full-viewport fixed overlay or inline container.
   * @default false
   */
  fullScreen?: boolean;
  /**
   * Primary label shown under the animated NUTS logo.
   */
  label?: string;
  /**
   * Secondary sub-caption shown under the primary label.
   */
  sublabel?: string;
  /**
   * Optional custom className.
   */
  className?: string;
  /**
   * Size preset for the NUTS emblem logo.
   * @default "lg"
   */
  size?: "sm" | "md" | "lg" | "xl";
}

const DEFAULT_MESSAGES = [
  "Loading marketplace...",
  "Curating fresh arrivals...",
  "Connecting to verified vendors...",
  "Almost ready...",
];

export function NutsLoadingScreen({
  fullScreen = false,
  label,
  sublabel,
  className = "",
  size = "lg",
}: NutsLoadingScreenProps) {
  const [messageIndex, setMessageIndex] = useState(0);

  // Cycle friendly messages every 2.4s if no static label was passed
  useEffect(() => {
    if (label) return;
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % DEFAULT_MESSAGES.length);
    }, 2400);
    return () => clearInterval(interval);
  }, [label]);

  const activeMessage = label || DEFAULT_MESSAGES[messageIndex];

  const logoDimensions = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-20 h-20",
    xl: "w-24 h-24",
  }[size];

  const content = (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading NUTS marketplace"
      className={`flex flex-col items-center justify-center select-none text-center ${className}`}
    >
      {/* Animated NUTS Favicon Emblem with Ambient Glow Waves */}
      <div className="relative flex items-center justify-center">
        {/* Soft Ambient Pulse Ring expanding outward */}
        <div
          className="absolute inset-0 -m-3 rounded-[24px] bg-black/10 dark:bg-white/10 animate-nuts-pulse-expand pointer-events-none"
          aria-hidden="true"
        />

        {/* Ambient Secondary Glow Ring */}
        <div
          className="absolute inset-0 -m-1.5 rounded-[22px] bg-gradient-to-tr from-black/15 to-transparent dark:from-white/15 dark:to-transparent blur-xs animate-pulse pointer-events-none"
          aria-hidden="true"
        />

        {/* Floating NUTS Favicon Emblem */}
        <div
          className={`relative z-10 ${logoDimensions} animate-nuts-logo-float transform-gpu transition-transform duration-300`}
        >
          <svg
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full drop-shadow-xl"
          >
            {/* Dark squircle container badge with delicate border */}
            <rect
              width="64"
              height="64"
              rx="18"
              fill="#09090b"
              className="dark:fill-neutral-900"
            />
            <rect
              x="0.75"
              y="0.75"
              width="62.5"
              height="62.5"
              rx="17.25"
              stroke="rgba(255, 255, 255, 0.15)"
              strokeWidth="1.5"
            />

            {/* Branded Shopping Bag Icon in Pure White */}
            <path
              d="M20 28h24l-3 20H23L20 28Z"
              fill="#ffffff"
            />
            {/* Shopping Bag Arch Handle */}
            <path
              d="M26 28v-5a6 6 0 0 1 12 0v5"
              stroke="#ffffff"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            {/* Bag Accent Lines */}
            <path
              d="M28 35h8M28 39h6"
              stroke="#09090b"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* Dynamic Status Caption & Minimal Micro Dots */}
      <div className="mt-5 flex flex-col items-center gap-1.5 px-4 max-w-xs">
        {activeMessage && (
          <p className="text-xs sm:text-sm font-medium text-neutral-800 dark:text-neutral-200 tracking-wide transition-all duration-300">
            {activeMessage}
          </p>
        )}

        {sublabel && (
          <p className="text-[11px] text-neutral-600 dark:text-neutral-400 font-normal">
            {sublabel}
          </p>
        )}

        {/* Micro Loading Progress Indicator Dots */}
        <div className="mt-1 flex items-center gap-1.5" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-black dark:bg-white animate-bounce [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-black/60 dark:bg-white/60 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-black/30 dark:bg-white/30 animate-bounce" />
        </div>
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/10 dark:bg-black/30 backdrop-blur-md transition-all duration-300 pointer-events-auto">
        {content}
      </div>
    );
  }

  return (
    <div className="py-12 flex items-center justify-center w-full">
      {content}
    </div>
  );
}
