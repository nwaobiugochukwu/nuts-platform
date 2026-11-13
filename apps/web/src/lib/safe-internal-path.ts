const INTERNAL_ORIGIN = 'https://nuts-internal.invalid';

/** Returns a same-site path, rejecting absolute and protocol-relative URLs. */
export function safeInternalPath(
  candidate: string | null | undefined,
  fallback: string,
): string {
  if (
    !candidate ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\') ||
    /[\u0000-\u001f]/.test(candidate)
  ) {
    return fallback;
  }

  try {
    const url = new URL(candidate, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
