"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Copy, Sparkles, Tag } from "lucide-react";
import { usePlatformPromos } from "@/hooks/use-product-deals";
import type { PublicPlatformPromoDto } from "@/api/dto/discount";
import { useDiscountStore } from "@/zustand/discount";
import { useClaimVoucher } from "@/hooks/use-claim-voucher";
import { toast } from "sonner";
import { formatPrice } from "@/lib/util";
import { RESUME_AFTER_INTERACTION_MS, dwellMs } from "@/lib/promo-timing";

const COLLAPSE_KEY = "nuts_promo_banner_v4";
function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/**
 * The offers bar is COLLAPSIBLE, not dismissible: a slim "offers available" strip
 * always stays, so a shopper can hide the full banner without losing sight of the
 * deals. The choice is remembered (site-wide, across tabs), and the bar re-opens
 * by itself when a campaign the shopper has not seen yet goes live.
 */
interface CollapseState {
  collapsed: boolean;
  /** Campaign ids on screen when the shopper collapsed the bar. */
  seenIds: string[];
}
const EMPTY_COLLAPSE: CollapseState = { collapsed: false, seenIds: [] };
const collapseListeners = new Set<() => void>();
let collapseCache: { raw: string | null; state: CollapseState } = { raw: null, state: EMPTY_COLLAPSE };

function readCollapse(): CollapseState {
  if (typeof window === "undefined") return EMPTY_COLLAPSE;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(COLLAPSE_KEY);
  } catch {
    return collapseCache.state;
  }
  if (raw === collapseCache.raw) return collapseCache.state;
  let state = EMPTY_COLLAPSE;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<CollapseState>) : null;
    if (parsed && typeof parsed === "object") {
      state = {
        collapsed: parsed.collapsed === true,
        seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds.filter((id) => typeof id === "string") : [],
      };
    }
  } catch {
    state = EMPTY_COLLAPSE;
  }
  collapseCache = { raw, state };
  return state;
}

function subscribeCollapse(listener: () => void) {
  collapseListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === COLLAPSE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function writeCollapse(state: CollapseState) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: keep it for this page view only.
    collapseCache = { raw: collapseCache.raw, state };
  }
  collapseListeners.forEach((listener) => listener());
}

interface CountdownInfo {
  type: "starts_in" | "ends_in" | "none";
  label: string;
  formatted: string;
  compact: string;
  isUrgent: boolean;
}

function computeCountdown(promo: PublicPlatformPromoDto, now: number): CountdownInfo | null {
  const startsAtTime = promo.startsAt ? new Date(promo.startsAt).getTime() : null;
  const expiresAtTime = promo.expiresAt ? new Date(promo.expiresAt).getTime() : null;

  let targetTime: number | null = null;
  let type: "starts_in" | "ends_in" | "none" = "none";
  let label = "";

  if (startsAtTime && startsAtTime > now) {
    targetTime = startsAtTime;
    type = "starts_in";
    label = "Starts in";
  } else if (expiresAtTime && expiresAtTime > now) {
    targetTime = expiresAtTime;
    type = "ends_in";
    label = "Ends in";
  } else {
    return null;
  }

  const diffMs = Math.max(0, targetTime - now);
  if (diffMs <= 0) return null;

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  const formatted =
    days > 0
      ? `${days}d : ${pad(hours)}h : ${pad(minutes)}m : ${pad(seconds)}s`
      : `${pad(hours)}h : ${pad(minutes)}m : ${pad(seconds)}s`;

  const compact =
    days > 0
      ? `${days}d ${pad(hours)}h`
      : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  const isUrgent = type === "ends_in" && diffMs < 24 * 60 * 60 * 1000;

  return {
    type,
    label,
    formatted,
    compact,
    isUrgent,
  };
}

export function PlatformPromoTicker({
  initialPromos,
}: {
  initialPromos?: PublicPlatformPromoDto[];
} = {}) {
  const { data: rawPromos, isError } = usePlatformPromos(initialPromos);
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
    // No usable client data (still loading, or the refresh failed): keep showing the
    // server-rendered campaigns that are safe for any viewer rather than a blank bar.
    return (initialPromos ?? []).filter((promo) => !promo.isFirstOrderOnly);
  }, [rawPromos, initialPromos]);

  const { claim } = useClaimVoucher();
  const claimedCodes = useDiscountStore((state) => state.claimedCodes);
  const appliedDiscounts = useDiscountStore((state) => state.appliedDiscounts);
  const isVoucherClaimed = (code: string) =>
    claimedCodes.includes(code) || appliedDiscounts.some((d) => d.code === code);
  const [currentIndex, setCurrentIndex] = useState(0);
  const collapse = useSyncExternalStore(subscribeCollapse, readCollapse, () => EMPTY_COLLAPSE);
  // Hover only counts on devices that can really hover: on touch screens a tap fires
  // `mouseenter` but never `mouseleave`, which used to pause the rotation for good.
  const [isHovering, setIsHovering] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [holdUntil, setHoldUntil] = useState(0);
  const tabVisible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
  const holdRotation = () => setHoldUntil(Date.now() + RESUME_AFTER_INTERACTION_MS);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // Wheel scroll throttling ref
  const lastWheelTime = useRef<number>(0);

  // Cursor drag & touch swipe tracking refs
  const dragStartX = useRef<number | null>(null);
  const isDragging = useRef<boolean>(false);
  const hasDragged = useRef<boolean>(false);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    const timeout = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(updateNow, 1000);
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

  // Development aid: say why the banner is hidden instead of leaving it a mystery.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || validPromos.length > 0) return;
    console.debug("[promo-banner] hidden", {
      received: promos.length,
      withoutCode: promos.filter((p) => !p.code).length,
      queryFailed: isError,
    });
  }, [validPromos.length, promos, isError]);

  // Automatic slide rotation: one timer per slide, so each offer gets its own dwell time
  // and any interaction (which changes the slide or the hold) restarts it cleanly.
  const rotatingPromo = validPromos[Math.min(currentIndex, Math.max(0, validPromos.length - 1))];
  const canRotate =
    validPromos.length > 1 && !isHovering && !hasFocus && tabVisible;
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && validPromos.length > 1 && !canRotate) {
      console.debug("[promo-banner] rotation paused", { isHovering, hasFocus, tabVisible });
    }
  }, [validPromos.length, canRotate, isHovering, hasFocus, tabVisible]);

  useEffect(() => {
    if (!canRotate || !rotatingPromo) return;
    const delay = Math.max(dwellMs((rotatingPromo.description ?? "").length), holdUntil - Date.now());
    const timer = window.setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % validPromos.length);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [canRotate, rotatingPromo, currentIndex, holdUntil, validPromos.length]);

  if (validPromos.length === 0) {
    return null;
  }

  const activeIndex = Math.min(currentIndex, Math.max(0, validPromos.length - 1));
  const activePromo = validPromos[activeIndex] ?? validPromos[0];
  if (!activePromo) {
    return null;
  }

  const countdown =
    now !== null
      ? computeCountdown(activePromo, now)
      : null;
  const isAutomatic = activePromo.autoApply === true;
  const isCurrentlyClaimed =
    !isAutomatic && isVoucherClaimed(activePromo.code);

  const handleClaim = (e: React.MouseEvent) => {
    if (hasDragged.current) return;
    e.stopPropagation();
    // An upcoming promo cannot be redeemed yet: claiming it would only produce
    // a "not active yet" failure at checkout. Tell the shopper instead.
    if (countdown?.type === "starts_in") {
      toast.info(`This voucher isn't active yet. It starts in ${countdown.formatted}.`);
      return;
    }
    const code = activePromo.code;
    void claim(code).then((claimed) => {
      if (!claimed) return;
      setCopiedCode(code);
      setTimeout(() => {
        setCopiedCode(null);
      }, 2500);
    });
  };

  // A campaign the shopper has not seen yet re-opens a collapsed bar.
  const hasUnseen = validPromos.some((promo) => !collapse.seenIds.includes(promo.id));
  const isCollapsed = collapse.collapsed && !hasUnseen;

  const handleCollapse = () =>
    writeCollapse({ collapsed: true, seenIds: validPromos.map((promo) => promo.id) });
  const handleExpand = () => writeCollapse({ collapsed: false, seenIds: [] });

  const handlePrev = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    holdRotation();
    setCurrentIndex((prev) => (prev - 1 + validPromos.length) % validPromos.length);
  };

  const handleNext = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    holdRotation();
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

  if (isCollapsed) {
    const headline =
      activePromo.type === "PERCENTAGE"
        ? `${activePromo.value}% OFF`
        : `Save ${formatPrice(activePromo.value)}`;
    return (
      <div
        role="region"
        aria-label="Platform promotional announcements (collapsed)"
        className="relative z-10 w-full border-b border-neutral-200/90 bg-neutral-100 text-neutral-900 dark:border-neutral-800/60 dark:bg-neutral-950 dark:text-neutral-100"
      >
        <button
          type="button"
          onClick={handleExpand}
          aria-expanded="false"
          className="mx-auto flex h-9 w-full max-w-7xl items-center justify-center gap-2 px-3 text-xs font-semibold transition-colors hover:bg-neutral-200/60 dark:hover:bg-neutral-900"
        >
          <Tag className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="shrink-0">
            {validPromos.length} {validPromos.length === 1 ? "offer" : "offers"} available
          </span>
          <span className="hidden truncate text-emerald-700 dark:text-emerald-400 sm:inline">· {headline}</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-neutral-500 dark:text-neutral-400">
            Show <ChevronDown className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Platform promotional announcements"
      className={`relative z-10 w-full overflow-hidden border-b transition-colors duration-300 select-none bg-neutral-100 text-neutral-900 border-neutral-200/90 shadow-xs dark:bg-neutral-950 dark:text-neutral-100 dark:border-neutral-800/60 ${
        validPromos.length > 1 ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      onMouseEnter={() => {
        if (window.matchMedia("(hover: hover)").matches) setIsHovering(true);
      }}
      // Only KEYBOARD focus pauses: a mouse or tap click on an arrow/dot/claim button leaves
      // it focused, which used to freeze the rotation until the shopper clicked elsewhere.
      onFocus={(event) => {
        if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) {
          setHasFocus(true);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHasFocus(false);
      }}
      onMouseLeave={(e) => {
        setIsHovering(false);
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
              className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white transition-colors active:scale-95 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Center: Active Promo Announcement */}
        <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-center px-1 text-center sm:flex-1">
          <div
            key={activePromo.id}
            className="flex min-w-0 max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5 sm:gap-x-3 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
          >
            {/* Promo Discount Pill */}
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-100/90 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-400 px-2.5 py-1 text-xs font-bold sm:text-[13px]">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>
                {activePromo.type === "PERCENTAGE"
                  ? `${activePromo.value}% OFF`
                  : `Save ${formatPrice(activePromo.value)}`}
              </span>
            </span>

            {/* Campaign Description */}
            <span className="min-w-0 max-w-full break-words text-xs font-semibold leading-snug tracking-tight text-neutral-900 dark:text-neutral-100 sm:text-sm">
              {activePromo.description || "Limited-time platform discount"}
            </span>

            {/* Minimum Spend */}
            {activePromo.minOrderAmount > 0 && (
              <span className="hidden text-xs font-normal md:inline whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                (Min. spend {formatPrice(activePromo.minOrderAmount)})
              </span>
            )}

            {/* Live Responsive Countdown Pill */}
            {countdown && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 sm:gap-1.5 rounded-full border px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-mono font-bold tracking-tight whitespace-nowrap transition-colors ${
                  countdown.isUrgent
                    ? "bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-300 animate-pulse"
                    : countdown.type === "starts_in"
                      ? "bg-sky-100 border-sky-300 text-sky-800 dark:bg-sky-500/15 dark:border-sky-500/30 dark:text-sky-300"
                      : "bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300"
                }`}
              >
                <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                <span>
                  {countdown.label} {countdown.formatted}
                </span>
              </span>
            )}

            {/* Automatic offers need no code or claim; others get the one-click claim button */}
            {isAutomatic ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-sky-600/30 bg-sky-100/90 px-2.5 py-1 text-[11px] font-bold text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/20 dark:text-sky-300 sm:px-3 sm:text-[13px]">
                <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                Applied automatically
              </span>
            ) : (
              <>
            <button
              type="button"
              onClick={handleClaim}
              title={`Click to copy and claim code ${activePromo.code}`}
              className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-mono font-bold transition-all cursor-pointer sm:px-3 sm:text-[13px] ${
                copiedCode === activePromo.code || isCurrentlyClaimed
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-50 shadow-xs dark:bg-neutral-800 dark:text-amber-300 dark:hover:bg-neutral-700 dark:hover:text-amber-200 dark:border-neutral-700 active:scale-95"
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
              </>
            )}
          </div>

          {/* Dots Indicator for multiple promos on Desktop */}
          {validPromos.length > 1 && (
            <div className="hidden items-center gap-1.5 sm:flex ml-3 shrink-0">
              {validPromos.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    holdRotation();
                    setCurrentIndex(idx);
                  }}
                  aria-label={`Go to promotion ${idx + 1}`}
                  className={`h-2 rounded-full transition-all cursor-pointer ${
                    idx === currentIndex
                      ? "w-5 bg-emerald-600 dark:bg-emerald-400"
                      : "w-2 bg-neutral-300 hover:bg-neutral-400 dark:bg-neutral-700 dark:hover:bg-neutral-500"
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
              className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white transition-colors active:scale-95 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleCollapse}
            aria-label="Collapse offers"
            title="Collapse offers (they stay one tap away)"
            aria-expanded="true"
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white transition-colors active:scale-95 ml-0.5 sm:ml-1 cursor-pointer"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>

        {/* Dots Indicator for multiple promos on Mobile */}
        {validPromos.length > 1 && (
          <div className="col-span-3 flex justify-center items-center gap-1.5 pt-1 sm:hidden">
            {validPromos.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                    holdRotation();
                    setCurrentIndex(idx);
                  }}
                aria-label={`Go to promotion ${idx + 1}`}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  idx === currentIndex
                    ? "w-4 bg-emerald-600 dark:bg-emerald-400"
                    : "w-1.5 bg-neutral-300 hover:bg-neutral-400 dark:bg-neutral-700 dark:hover:bg-neutral-500"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
