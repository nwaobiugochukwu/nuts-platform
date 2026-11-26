/**
 * Pure rules for when a saved scroll position may be restored.
 *
 * A saved position is only useful when the shopper is going Back/Forward to a
 * page they were already on. A fresh visit (a link, the logo, a menu, a reload
 * or a new tab) must start at the top, otherwise the shopper has to scroll up
 * before they can use the page.
 */

/** A popstate this recent before a page mounts means the page was reached via Back/Forward. */
export const TRAVERSAL_WINDOW_MS = 3_000;

/** How long to wait for a page to grow tall enough to reach the saved spot. */
export const RESTORE_GIVE_UP_MS = 2_000;

/** Positions closer to the top than this are not worth restoring. */
export const MIN_RESTORE_OFFSET = 40;

export function parseSavedScroll(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < MIN_RESTORE_OFFSET) return null;
  return value;
}

export function isRecentTraversal(
  now: number,
  lastPopstateAt: number | null,
  windowMs = TRAVERSAL_WINDOW_MS,
): boolean {
  return lastPopstateAt !== null && now - lastPopstateAt <= windowMs;
}

/**
 * `navigationType` is the first `PerformanceNavigationTiming.type` of the
 * document ("navigate", "reload", "back_forward", "prerender"). It covers the
 * case where Back leaves the site and returns, reloading the app.
 */
export function wasReachedByTraversal(input: {
  now: number;
  lastPopstateAt: number | null;
  navigationType?: string | null;
  isFirstMountOfDocument: boolean;
}): boolean {
  if (isRecentTraversal(input.now, input.lastPopstateAt)) return true;
  return input.isFirstMountOfDocument && input.navigationType === "back_forward";
}

export type RestoreDecision =
  | { action: "restore"; top: number }
  | { action: "clear" }
  | { action: "none" };

/**
 * Decide what to do on mount. A fresh visit clears whatever was saved so the
 * next Back starts from this visit, not an older one.
 */
export function decideRestore(input: {
  saved: string | null | undefined;
  isTraversal: boolean;
}): RestoreDecision {
  if (!input.isTraversal) {
    return input.saved ? { action: "clear" } : { action: "none" };
  }
  const top = parseSavedScroll(input.saved);
  return top === null ? { action: "none" } : { action: "restore", top };
}

/** The page can be scrolled to `top` only if it is tall enough. */
export function canReachOffset(
  documentHeight: number,
  viewportHeight: number,
  top: number,
): boolean {
  return documentHeight - viewportHeight >= top;
}
