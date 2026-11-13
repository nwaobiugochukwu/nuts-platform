/** Accept only the HTTPS hosted checkout URL returned by Paystack. */
export function safePaystackCheckoutUrl(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length > 2048) return null;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const isPaystackHost =
      host === 'paystack.com' ||
      host.endsWith('.paystack.com') ||
      host === 'paystack.co' ||
      host.endsWith('.paystack.co');

    if (
      url.protocol !== 'https:' ||
      !isPaystackHost ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
