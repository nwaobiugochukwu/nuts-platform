/**
 * The browser's own chrome (the status bar and address bar on a phone) takes its colour
 * from `<meta name="theme-color">`, not from the page. Next renders that tag once, from the
 * phone's OS light/dark setting, so switching the app's theme repainted the page but left
 * the top bar in the old colour until a reload. These helpers keep the bar in step with
 * the theme the user actually picked.
 *
 * IMPORTANT: never remove, move or edit the theme-color tags Next/React render. React 19
 * hoists `<meta>` tags into <head> and removes them itself on navigation; if another
 * script already removed one, React throws "Cannot read properties of null (reading
 * 'removeChild')" and the app stops responding. Instead we own ONE extra tag, marked with
 * `data-nuts-theme-color`, placed first in <head>. When several theme-color tags match, the
 * first one in document order wins, so ours decides the colour and React's are left alone.
 *
 * The values are the page background in each theme (`--background` in globals.css).
 */
export const THEME_COLORS = { light: "#ffffff", dark: "#09090b" } as const;

export type ResolvedTheme = keyof typeof THEME_COLORS;

/** Marks the one tag this module owns. */
export const THEME_COLOR_OWN_ATTRIBUTE = "data-nuts-theme-color";

export function themeColorFor(resolved: ResolvedTheme): string {
  return THEME_COLORS[resolved];
}

/** The slice of `Document` this needs; lets tests pass a small fake. */
export interface ThemeColorDocument {
  head: {
    querySelector(selector: string): ThemeColorMeta | null;
    prepend(node: ThemeColorMeta): void;
  };
  createElement(tag: "meta"): ThemeColorMeta;
}

export interface ThemeColorMeta {
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
}

/**
 * Creates our tag once (first in <head>) and keeps its colour equal to `resolved`.
 * Idempotent, and it never touches any node it did not create.
 */
export function applyThemeColorMeta(
  resolved: ResolvedTheme,
  doc: ThemeColorDocument | undefined = typeof document === "undefined"
    ? undefined
    : (document as unknown as ThemeColorDocument),
): void {
  if (!doc) return;
  const color = themeColorFor(resolved);

  let own = doc.head.querySelector(`meta[${THEME_COLOR_OWN_ATTRIBUTE}]`);
  if (!own) {
    own = doc.createElement("meta");
    own.setAttribute("name", "theme-color");
    own.setAttribute(THEME_COLOR_OWN_ATTRIBUTE, "");
    doc.head.prepend(own);
  }
  if (own.getAttribute("content") !== color) own.setAttribute("content", color);
}
