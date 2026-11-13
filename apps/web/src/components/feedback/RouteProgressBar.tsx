"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Global event bus for triggering progress programmatically
export const routeProgress = {
  start: () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nuts:route-progress-start"));
    }
  },
  done: () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nuts:route-progress-done"));
    }
  },
};

export function RouteProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startProgress = () => {
    if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    setVisible(true);
    setProgress(15);

    timerRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 85) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 85;
        }
        // Organic diminishing increments
        const diff = (90 - prev) * 0.12;
        return Math.min(85, prev + Math.max(diff, 1.5));
      });
    }, 120);
  };

  const finishProgress = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(100);

    fadeTimeoutRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 280);
  };

  const isFirstRender = useRef(true);

  // Complete progress whenever the route or search parameters finish changing
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      finishProgress();
    }, 0);
    return () => clearTimeout(timeout);
  }, [pathname, searchParams]);

  // Intercept internal link clicks to immediately initiate progress bar
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a");

      if (!anchor) return;

      const href = anchor.getAttribute("href");
      const targetAttr = anchor.getAttribute("target");

      // Only intercept standard internal navigations
      if (
        href &&
        href.startsWith("/") &&
        !href.startsWith("//") &&
        !href.startsWith("/#") &&
        (!targetAttr || targetAttr === "_self") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.defaultPrevented
      ) {
        // Only start if not already on the exact same full URL
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        if (href !== currentUrl) {
          startProgress();
        }
      }
    };

    const handleCustomStart = () => startProgress();
    const handleCustomDone = () => finishProgress();

    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("nuts:route-progress-start", handleCustomStart);
    window.addEventListener("nuts:route-progress-done", handleCustomDone);

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("nuts:route-progress-start", handleCustomStart);
      window.removeEventListener("nuts:route-progress-done", handleCustomDone);
      if (timerRef.current) clearInterval(timerRef.current);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, []);

  if (!visible && progress === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 z-[9999] h-[3px] pointer-events-none transition-opacity duration-300"
      style={{
        opacity: visible ? 1 : 0,
      }}
    >
      <div
        className="h-full bg-black dark:bg-white transition-all duration-200 ease-out shadow-xs"
        style={{
          width: `${progress}%`,
        }}
      />
    </div>
  );
}
