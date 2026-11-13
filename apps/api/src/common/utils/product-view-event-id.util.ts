import { createHash } from 'node:crypto';

interface ProductViewIdentity {
  productId: string;
  userId?: string | null;
  visitorId?: string | null;
  sessionId?: string | null;
  timestamp?: string | number | Date;
}

/**
 * Gives legacy buffered/queued product views a stable database key. New events
 * carry a client-generated ID; this fallback keeps redelivered legacy messages
 * idempotent using the fields older producers already persisted.
 */
export function productViewEventId(identity: ProductViewIdentity): string {
  const timestamp =
    identity.timestamp instanceof Date
      ? identity.timestamp.toISOString()
      : String(identity.timestamp ?? '');
  const fingerprint = [
    identity.productId,
    identity.userId ?? '',
    identity.visitorId ?? '',
    identity.sessionId ?? '',
    timestamp,
  ].join('\u001f');
  const hex = createHash('sha256')
    .update(fingerprint)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');

  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
