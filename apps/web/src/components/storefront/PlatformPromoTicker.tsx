"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clock, Copy, Sparkles, Tag, X } from "lucide-react";
import { usePlatformPromos } from "@/hooks/use-product-deals";
import { useDiscountStore } from "@/zustand/discount";
import { formatPrice } from "@/lib/util";
import type { PublicPlatformPromoDto } from "@/api/dto/discount";

const DISMISS_KEY = "nuts_promo_ticker_dismissed";
const ROTATION_INTERVAL_MS = 6000;

const FALLBACK_PROMOS: PublicPlatformPromoDto[] = [
  {
    id: "promo-welcome10",
    code: "WELCOME10",
    description: "First Order Special: 10% off for first-time shoppers",
    type: "PERCENTAGE",
    value: 10,
    minOrderAmount: 25000,
    maxDiscountAmount: 15000,
    isFirstOrderOnly: true,
  },
];

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

export function PlatformPromoTicker() {
  const { data: promos = [] } = usePlatformPromos();
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
    const activeList = promos.length > 0 ? promos : FALLBACK_PROMOS;
    const filtered = activeList.filter((p) => {
      if (!p.code) return false;
      if (now !== null && p.expiresAt && new Date(p.expiresAt).getTime() <= now) {
        return false;
      }
      return true;
    });
    return filtered.length > 0 ? filtered : FALLBACK_PROMOS;
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

  const activePromo = validPromos[currentIndex] ?? validPromos[0];
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
      className={`relative z-50 w-full border-b transition-colors duration-300 select-none ${
        /* Light mode: rich dark banner for high contrast against white page.
           Dark mode: crisp white/light banner for striking contrast against dark page. */
        "bg-neutral-950 text-neutral-100 border-neutral-800 shadow-sm dark:bg-white dark:text-neutral-950 dark:border-neutral-200"
      } ${
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
      <div className="mx-auto flex min-h-[46px] sm:min-h-[50px] max-w-7xl items-center justify-between gap-1.5 px-2 py-2 sm:px-6 sm:py-2.5 lg:px-8">
        {/* Left: Previous Navigation Button */}
        <div className="flex shrink-0 items-center">
          {validPromos.length > 1 && (
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Previous promotion"
              className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white dark:text-neutral-600 dark:hover:bg-neutral-100 dark:hover:text-neutral-900 transition-colors active:scale-95 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Center: Active Promo Announcement */}
        <div className="flex flex-1 items-center justify-center overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-1 text-center">
          <div
            key={activePromo.id}
            className="inline-flex flex-nowrap sm:flex-wrap items-center justify-center gap-2 sm:gap-3 animate-in fade-in slide-in-from-bottom-1 duration-300"
          >
            {/* Promo Discount Pill */}
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs sm:text-[13px] font-bold shrink-0 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 dark:bg-emerald-600/10 dark:text-emerald-700 dark:border-emerald-600/30">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>
                {activePromo.type === "PERCENTAGE"
                  ? `${activePromo.value}% OFF`
                  : `Save ${formatPrice(activePromo.value)}`}
              </span>
            </span>

            {/* Campaign Description */}
            <span className="text-xs sm:text-sm font-semibold tracking-tight whitespace-nowrap sm:whitespace-normal text-neutral-100 dark:text-neutral-950">
              {activePromo.description || "Limited-time platform discount"}
            </span>

            {/* Minimum Spend */}
            {activePromo.minOrderAmount > 0 && (
              <span className="hidden text-xs font-normal md:inline whitespace-nowrap text-neutral-400 dark:text-neutral-600">
                (Min. spend {formatPrice(activePromo.minOrderAmount)})
              </span>
            )}

            {/* Expiration Countdown */}
            {timeRemaining && (
              <span className="hidden items-center gap-1 text-xs font-medium lg:inline-flex whitespace-nowrap text-amber-400 dark:text-amber-600">
                <Clock className="h-3.5 w-3.5" />
                <span>{timeRemaining}</span>
              </span>
            )}

            {/* One-Click Claim / Code Button */}
            <button
              type="button"
              onClick={handleClaim}
              title={`Click to copy and claim code ${activePromo.code}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs sm:text-[13px] font-mono font-bold transition-all shrink-0 cursor-pointer ${
                copiedCode === activePromo.code || isCurrentlyClaimed
                  ? "bg-emerald-500 text-white shadow-xs"
                  : "bg-neutral-800 text-amber-300 hover:bg-neutral-700 hover:text-amber-200 border border-neutral-700 dark:bg-neutral-900 dark:text-amber-400 dark:hover:bg-neutral-800 dark:border-neutral-800 active:scale-95"
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              <span>{activePromo.code}</span>
              {copiedCode === activePromo.code || isCurrentlyClaimed ? (
                <Check className="h-3.5 w-3.5 stroke-[2.5]" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-400" />
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
                      ? "w-5 bg-emerald-400 dark:bg-emerald-600"
                      : "w-2 bg-neutral-700 hover:bg-neutral-500 dark:bg-neutral-300 dark:hover:bg-neutral-400"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: Next Navigation Button + Dismiss 'X' */}
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {validPromos.length > 1 && (
            <button
              type="button"
              onClick={handleNext}
              aria-label="Next promotion"
              className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white dark:text-neutral-600 dark:hover:bg-neutral-100 dark:hover:text-neutral-900 transition-colors active:scale-95 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss promotion banner"
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 dark:text-neutral-600 dark:hover:bg-neutral-100 dark:hover:text-neutral-900 transition-colors active:scale-95 ml-0.5 sm:ml-1 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
