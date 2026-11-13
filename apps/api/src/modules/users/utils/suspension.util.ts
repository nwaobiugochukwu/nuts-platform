export interface ParsedSuspension {
  isSuspended: boolean;
  reason: string;
  suspendedUntil: Date | null;
  isIndefinite: boolean;
  isExpired: boolean;
}

/**
 * Encodes the suspension duration and reason into a deterministic structured prefix.
 * Preserves full backward compatibility: if no until date is provided, marked as indefinite.
 */
export function formatSuspensionReason(
  reason: string,
  suspendedUntil: Date | null,
): string {
  const cleanReason = reason.trim();
  if (!suspendedUntil) {
    return `[SUSPENSION|until:indefinite] ${cleanReason}`;
  }
  return `[SUSPENSION|until:${suspendedUntil.toISOString()}] ${cleanReason}`;
}

/**
 * Calculates a suspendedUntil date from preset duration string (e.g. '24h', '3d', '7d', '14d', '30d')
 * or an explicit ISO string.
 */
export function calculateSuspensionExpiry(
  duration?: string,
  suspendedUntilIso?: string,
): Date | null {
  if (suspendedUntilIso) {
    const parsed = new Date(suspendedUntilIso);
    if (!isNaN(parsed.getTime()) && parsed > new Date()) {
      return parsed;
    }
  }

  if (!duration || duration === 'indefinite' || duration === 'permanent') {
    return null;
  }

  const now = Date.now();
  switch (duration.toLowerCase()) {
    case '24h':
    case '1d':
      return new Date(now + 24 * 60 * 60 * 1000);
    case '3d':
      return new Date(now + 3 * 24 * 60 * 60 * 1000);
    case '7d':
    case '1w':
      return new Date(now + 7 * 24 * 60 * 60 * 1000);
    case '14d':
    case '2w':
      return new Date(now + 14 * 24 * 60 * 60 * 1000);
    case '30d':
    case '1m':
      return new Date(now + 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

/**
 * Parses suspension metadata from deactivationReason and checks if the suspension has expired.
 */
export function parseSuspension(
  deactivationReason: string | null | undefined,
  deactivatedBy: string | null | undefined,
): ParsedSuspension {
  if (!deactivatedBy) {
    return {
      isSuspended: false,
      reason: deactivationReason || '',
      suspendedUntil: null,
      isIndefinite: false,
      isExpired: false,
    };
  }

  const text = (deactivationReason || '').trim();
  const match = text.match(/^\[SUSPENSION\|until:([^\]]+)\]\s*([\s\S]*)$/);

  if (match) {
    const rawUntil = match[1];
    const cleanReason = match[2] || 'Administrative suspension';
    if (rawUntil === 'indefinite' || !rawUntil) {
      return {
        isSuspended: true,
        reason: cleanReason,
        suspendedUntil: null,
        isIndefinite: true,
        isExpired: false,
      };
    }

    const untilDate = new Date(rawUntil);
    const isDateValid = !isNaN(untilDate.getTime());
    if (isDateValid) {
      const isExpired = Date.now() >= untilDate.getTime();
      return {
        isSuspended: !isExpired,
        reason: cleanReason,
        suspendedUntil: untilDate,
        isIndefinite: false,
        isExpired,
      };
    }
  }

  // Fallback for legacy plain text entries: treat as indefinite suspension
  return {
    isSuspended: true,
    reason: text || 'Account suspended by administrator',
    suspendedUntil: null,
    isIndefinite: true,
    isExpired: false,
  };
}
