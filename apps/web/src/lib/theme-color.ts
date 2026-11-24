/**
 * The browser's own chrome (the status bar and address bar on a phone) takes its colour
 * from `<meta name="theme-color">`, not from the page. Next renders that tag once, from the
 * phone's OS light/dark setting, so switching the app's theme repainted the page but left
 * the top bar in the old colour until a reload. These helpers keep the tag in step with
 * the theme the user actually picked.
 *
 * The values are the page background in each theme (`--background` in globals.css).
 */
export const THEME_COLORS = { light: "#ffffff", dark: "#09090b" } as const;

export type ResolvedTheme = keyof typeof THEME_COLORS;

export function themeColorFor(resolved: ResolvedTheme): string {
  return THEME_COLORS[resolved];
}

/**
 * Makes exactly one theme-color tag, without a `media` condition, with the colour of
 * `resolved`. Idempotent (no DOM writes when already correct), so it is safe to call from
 * a MutationObserver that watches <head> without looping.
 */
export function applyThemeColorMeta(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const color = themeColorFor(resolved);
  const tags = Array.from(
    document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  );

  let primary = tags.find((tag) => !tag.hasAttribute("media")) ?? tags[0];
  if (!primary) {
    primary = document.createElement("meta");
    primary.setAttribute("name", "theme-color");
    document.head.appendChild(primary);
  }
  // Media-conditioned tags (the OS-based pair Next renders) would win for the OS theme.
  for (const tag of tags) if (tag !== primary) tag.remove();
  if (primary.hasAttribute("media")) primary.removeAttribute("media");
  if (primary.getAttribute("content") !== color) primary.setAttribute("content", color);
}
