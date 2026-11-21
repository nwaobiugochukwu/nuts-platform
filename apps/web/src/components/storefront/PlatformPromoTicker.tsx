"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clock, Copy, Sparkles, Tag, X } from "lucide-react";
import { usePlatformPromos } from "@/hooks/use-product-deals";
import type { PublicPlatformPromoDto } from "@/api/dto/discount";
import { useDiscountStore } from "@/zustand/discount";
import { formatPrice } from "@/lib/util";

const DISMISS_KEY = "nuts_promo_ticker_dismissed";
const ROTATION_INTERVAL_MS = 6000;

function formatTimeRemaining(expiresAt: string | Date, now: number): string | null {
  const diffMs = new Date(expiresAt).getTime() - now;
  if (diffMs <= 0) return null;
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours > 72) return null;

  const hours = Math.floor(diffHours);
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours < 1) return `${minutes}m left`;
  return `${hours}h ${minutes}m left`;
}

export function PlatformPromoTicker({
  initialPromos,
}: {
  initialPromos?: PublicPlatformPromoDto[];
} = {}) {
  const { data: rawPromos } = usePlatformPromos(initialPromos);
  const promos = useMemo(() => {
    if (Array.isArray(rawPromos)) return rawPromos;
    if (
      rawPromos &&
      typeof rawPromos === "object" &&
      "data" in rawPromos &&
      Array.isArray((rawPromos as { data: unknown }).data)
    ) {
      return (rawPromos as { data: typeof rawPromos }).data;
    }
    return initialPromos ?? [];
  }, [rawPromos, initialPromos]);

  const { claimCode, claimedCode, appliedDiscount } = useDiscountStore();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Wheel scroll throttling ref
  const lastWheelTime = useRef<number>(0);

  // Cursor drag & touch swipe tracking refs
  const dragStartX = useRef<number | null>(null);
  const isDragging = useRef<boolean>(false);
  const hasDragged = useRef<boolean>(false);

  // Clear any stale dismissal lock on mount so user always sees promotions
  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(DISMISS_KEY);
    }
  }, []);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    const timeout = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(updateNow, 60_000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  const validPromos = useMemo(() => {
    return promos.filter((p) => {
      if (!p.code) return false;
      if (now !== null && p.expiresAt && new Date(p.expiresAt).getTime() <= now) {
        return false;
      }
      return true;
    });
  }, [promos, now]);

  // Automatic slide rotation
  useEffect(() => {
    if (validPromos.length <= 1 || isPaused || isDismissed) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % validPromos.length);
    }, ROTATION_INTERVAL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [validPromos.length, isPaused, isDismissed]);

  if (isDismissed || validPromos.length === 0) {
    return null;
  }

  const activeIndex = Math.min(currentIndex, Math.max(0, validPromos.length - 1));
  const activePromo = validPromos[activeIndex] ?? validPromos[0];
  if (!activePromo) {
    return null;
  }

  const timeRemaining =
    activePromo.expiresAt && now !== null
      ? formatTimeRemaining(activePromo.expiresAt, now)
      : null;
  const isCurrentlyClaimed =
    claimedCode === activePromo.code || appliedDiscount?.code === activePromo.code;

  const handleClaim = (e: React.MouseEvent) => {
    if (hasDragged.current) return;
    e.stopPropagation();
    claimCode(activePromo.code);
    setCopiedCode(activePromo.code);
    setTimeout(() => {
      setCopiedCode(null);
    }, 2500);
  };

  const handleDismiss = () => {
    setIsDismissed(true);
  };

  const handlePrev = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + validPromos.length) % validPromos.length);
  };

  const handleNext = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % validPromos.length);
  };

  // --- Mouse Wheel Scrolling (Cursor wheel flips through discount codes) ---
  const handleWheel = (e: React.WheelEvent) => {
    if (validPromos.length <= 1) return;
    const now = Date.now();
    if (now - lastWheelTime.current < 250) return;

    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) > 15) {
      lastWheelTime.current = now;
      if (delta > 0) {
        handleNext();
      } else {
        handlePrev();
      }
    }
  };

  // --- Mouse Cursor Drag to Scroll Through ---
  const handleMouseDown = (e: React.MouseEvent) => {
    dragStartX.current = e.clientX;
    isDragging.current = true;
    hasDragged.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || dragStartX.current === null) return;
    const diff = dragStartX.current - e.clientX;
    if (Math.abs(diff) > 10) {
      hasDragged.current = true;
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isDragging.current && dragStartX.current !== null) {
      const diff = dragStartX.current - e.clientX;
      if (Math.abs(diff) > 40 && validPromos.length > 1) {
        if (diff > 0) {
          handleNext();
        } else {
          handlePrev();
        }
      }
    }
    isDragging.current = false;
    dragStartX.current = null;
    setTimeout(() => {
      hasDragged.current = false;
    }, 50);
  };

  // --- Touch Swipe for Mobile ---
  const handleTouchStart = (e: React.TouchEvent) => {
    dragStartX.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (dragStartX.current !== null) {
      const endX = e.changedTouches[0]?.clientX ?? dragStartX.current;
      const diff = dragStartX.current - endX;
      if (Math.abs(diff) > 40 && validPromos.length > 1) {
        if (diff > 0) {
          handleNext();
        } else {
          handlePrev();
        }
      }
    }
    dragStartX.current = null;
  };

  return (
    <div
      role="region"
      aria-label="Platform promotional announcements"
      className={`relative z-50 w-full border-b transition-colors duration-300 select-none bg-neutral-900 text-neutral-100 border-neutral-800/80 shadow-xs dark:bg-neutral-950 dark:text-neutral-100 dark:border-neutral-800/60 ${
        validPromos.length > 1 ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={(e) => {
        setIsPaused(false);
        handleMouseUp(e);
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="mx-auto grid min-h-[46px] max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-1 px-2 py-2 sm:flex sm:min-h-[50px] sm:justify-between sm:gap-2 sm:px-6 sm:py-2.5 lg:px-8">
        {/* Left: Previous Navigation Button */}
        <div className="flex shrink-0 items-center">
          {validPromos.length > 1 && (
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Previous promotion"
              className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors active:scale-95 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Center: Active Promo Announcement */}
        <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-center px-1 text-center sm:flex-1">
          <div
            key={activePromo.id}
            className="flex min-w-0 max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5 sm:gap-x-3 animate-in fade-in slide-in-from-bottom-1 duration-300"
          >
            {/* Promo Discount Pill */}
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-400 sm:text-[13px]">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>
                {activePromo.type === "PERCENTAGE"
                  ? `${activePromo.value}% OFF`
                  : `Save ${formatPrice(activePromo.value)}`}
              </span>
            </span>

            {/* Campaign Description */}
            <span className="min-w-0 max-w-full break-words text-xs font-semibold leading-snug tracking-tight text-neutral-100 sm:text-sm">
              {activePromo.description || "Limited-time platform discount"}
            </span>

            {/* Minimum Spend */}
            {activePromo.minOrderAmount > 0 && (
              <span className="hidden text-xs font-normal md:inline whitespace-nowrap text-neutral-400">
                (Min. spend {formatPrice(activePromo.minOrderAmount)})
              </span>
            )}

            {/* Expiration Countdown */}
            {timeRemaining && (
              <span className="hidden items-center gap-1 text-xs font-medium lg:inline-flex whitespace-nowrap text-amber-400">
                <Clock className="h-3.5 w-3.5" />
                <span>{timeRemaining}</span>
              </span>
            )}

            {/* One-Click Claim / Code Button */}
            <button
              type="button"
              onClick={handleClaim}
              title={`Click to copy and claim code ${activePromo.code}`}
              className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-mono font-bold transition-all cursor-pointer sm:px-3 sm:text-[13px] ${
                copiedCode === activePromo.code || isCurrentlyClaimed
                  ? "bg-emerald-500 text-white shadow-xs"
                  : "bg-neutral-800 text-amber-300 hover:bg-neutral-700 hover:text-amber-200 border border-neutral-700 active:scale-95"
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              <span className="max-w-[28vw] truncate sm:max-w-none">{activePromo.code}</span>
              {copiedCode === activePromo.code || isCurrentlyClaimed ? (
                <Check className="h-3.5 w-3.5 stroke-[2.5]" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-neutral-400" />
              )}
            </button>
          </div>

          {/* Dots Indicator for multiple promos */}
          {validPromos.length > 1 && (
            <div className="hidden items-center gap-1.5 sm:flex ml-3 shrink-0">
              {validPromos.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  aria-label={`Go to promotion ${idx + 1}`}
                  className={`h-2 rounded-full transition-all cursor-pointer ${
                    idx === currentIndex
                      ? "w-5 bg-emerald-400"
                      : "w-2 bg-neutral-700 hover:bg-neutral-500"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: Next Navigation Button + Dismiss 'X' */}
        <div className="col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-0.5 sm:gap-1">
          {validPromos.length > 1 && (
            <button
              type="button"
              onClick={handleNext}
              aria-label="Next promotion"
              className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors active:scale-95 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss promotion banner"
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors active:scale-95 ml-0.5 sm:ml-1 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
