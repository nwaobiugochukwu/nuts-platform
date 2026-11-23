/**
 * In-app navigation memory, so "Back" returns to where the user came from
 * (a notification, a search, a list) instead of a hard-coded parent page.
 *
 * The stack lives in memory only: a full page reload starts a fresh one and
 * the UI falls back to a sensible parent link.
 */
const MAX_ENTRIES = 50;
let stack: string[] = [];

/** Called on every client-side route change. */
export function recordNavigation(path: string): void {
  if (stack[stack.length - 1] === path) return;
  stack.push(path);
  if (stack.length > MAX_ENTRIES) stack = stack.slice(-MAX_ENTRIES);
}

/** Called when the browser moves back/forward (popstate): drop the page being left. */
export function recordHistoryPop(): void {
  stack.pop();
}

/**
 * The page before `currentPath`. A page can render before the tracker has
 * recorded it, so when the top of the stack is not the current page, the top
 * IS the previous page.
 */
export function previousPath(currentPath?: string): string | null {
  const top = stack[stack.length - 1];
  if (top === undefined) return null;
  const topIsCurrent = currentPath === undefined || top.split(/[?#]/)[0] === currentPath;
  if (!topIsCurrent) return top;
  return stack.length > 1 ? (stack[stack.length - 2] ?? null) : null;
}

export function canGoBackInApp(currentPath?: string): boolean {
  return previousPath(currentPath) !== null;
}

export function resetNavigationHistory(): void {
  stack = [];
}

/**
 * Names for "Back to ...". Order matters: the first match wins, so specific pages
 * (an order, a message) come before their list pages, and a label is only given when
 * it is accurate; otherwise the link just says "Back".
 */
const LABELS: Array<[RegExp, string]> = [
  // Notifications: the inbox vs one message.
  [/^\/(vendor\/|admin\/)?notifications\/[^/]+/, "the notification"],
  [/^\/(vendor\/|admin\/)?notifications/, "notifications"],
  // Orders: one order vs the list, per portal.
  [/^\/(vendor|admin)\/order\/[^/]+/, "the order"],
  [/^\/(vendor|admin)\/order/, "orders"],
  [/^\/order-success/, "your order confirmation"],
  [/^\/order\/[^/]+/, "your order"],
  [/^\/order/, "your orders"],
  // Vendor portal pages.
  [/^\/vendor\/analytic/, "analytics"],
  [/^\/vendor\/product/, "your products"],
  [/^\/vendor\/discount/, "your discounts"],
  [/^\/vendor\/wallet/, "your wallet"],
  [/^\/vendor\/setting/, "store settings"],
  // Admin portal pages.
  [/^\/admin\/analytic/, "analytics"],
  [/^\/admin\/announcements/, "announcements"],
  [/^\/admin\/category/, "categories"],
  [/^\/admin\/discount/, "discounts"],
  [/^\/admin\/platform/, "platform settings"],
  [/^\/admin\/product/, "products"],
  [/^\/admin\/setting/, "settings"],
  [/^\/admin\/staff/, "staff"],
  [/^\/admin\/user/, "users"],
  [/^\/admin\/vendor/, "vendors"],
  [/^\/admin\/?$/, "the dashboard"],
  // Storefront.
  [/^\/vouchers/, "your vouchers"],
  [/^\/account\/following/, "followed stores"],
  [/^\/account/, "your account"],
  [/^\/cart/, "your cart"],
  [/^\/checkout/, "checkout"],
  [/^\/wishlist/, "your wishlist"],
  [/^\/wallet/, "your wallet"],
  [/^\/search/, "search results"],
  [/^\/discover/, "discover"],
  [/^\/category/, "the category"],
  [/^\/product\/[^/]+/, "the product"],
  [/^\/vendor\/?$/, "stores"],
  [/^\/vendor\/[^/]+/, "the store"],
  [/^\/$/, "home"],
];

/** "Back to <where you came from>", or null when we have no good name for it. */
export function describePath(path: string | null): string | null {
  if (!path) return null;
  const pathname = path.split(/[?#]/)[0] ?? path;
  for (const [pattern, label] of LABELS) if (pattern.test(pathname)) return label;
  return null;
}
