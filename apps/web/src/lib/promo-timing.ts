/**
 * Rotation timing for the offers bar, in line with large retailers' announcement bars:
 *  - each offer stays at least 5 s, longer when its text is long (+40 ms per character
 *    past 40, capped at 8 s) so it can actually be read;
 *  - a shopper who hovers, keyboard-focuses, taps, swipes or uses the arrows/dots keeps
 *    control: rotation resumes 10 s after the last interaction (a click that merely
 *    leaves a button focused does not pause it);
 *  - it never rotates in a background tab. "Reduce motion" removes the slide animation
 *    but not the rotation: that preference is about movement, and many Windows setups
 *    report it just because animation effects are off (WCAG 2.2.2: pausable).
 */
export const MIN_DWELL_MS = 5000;
export const MAX_DWELL_MS = 8000;
export const EXTRA_MS_PER_CHAR = 40;
export const FREE_CHARS = 40;
export const RESUME_AFTER_INTERACTION_MS = 10_000;

/** How long to show an offer whose description has `descriptionLength` characters. */
export function dwellMs(descriptionLength: number): number {
  return Math.min(
    MAX_DWELL_MS,
    MIN_DWELL_MS + Math.max(0, descriptionLength - FREE_CHARS) * EXTRA_MS_PER_CHAR,
  );
}
