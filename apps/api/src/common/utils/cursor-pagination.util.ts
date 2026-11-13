// ─── Cursor encoding / decoding ──────────────────────────────────────────────

/**
 * Cursor payload — the sort key values of the last item on a page.
 * Encoded as base64 JSON so it stays opaque to clients but stable.
 */
export type CursorPayload = Record<string, string | number | Date>;

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T extends CursorPayload = CursorPayload>(
  cursor?: string,
): T | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // Revive ISO date strings back to Date objects
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
      ) {
        parsed[key] = new Date(value);
      }
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * Build the Prisma `where` clauses that implement "strictly after the
 * cursor position" for a composite sort key. Uses the standard
 * row-value comparison trick expanded into OR clauses.
 *
 * Example for { createdAt: desc, id: desc }:
 *   OR: [
 *     { createdAt: { lt: cursor.createdAt } },
 *     { createdAt: cursor.createdAt, id: { lt: cursor.id } },
 *   ]
 */
export function buildCursorWhere(
  cursor: CursorPayload,
  direction: 'asc' | 'desc',
): Record<string, unknown>[] {
  const keys = Object.keys(cursor);
  const op = direction === 'desc' ? 'lt' : 'gt';
  const clauses: Record<string, unknown>[] = [];

  for (let i = 0; i < keys.length; i++) {
    const clause: Record<string, unknown> = {};
    // Equal on all previous keys
    for (let j = 0; j < i; j++) {
      clause[keys[j]] = cursor[keys[j]];
    }
    // Strictly before/after on the current key
    clause[keys[i]] = { [op]: cursor[keys[i]] };
    clauses.push(clause);
  }

  return clauses;
}

// ─── Cursor pagination meta ──────────────────────────────────────────────────

export class CursorPaginationMetaDto {
  limit!: number;
  hasNextPage!: boolean;
  nextCursor!: string | null;
}

/**
 * Build cursor pagination metadata from the fetched page.
 *
 * @param fetched   The fetched rows (must be `limit + 1` rows so `hasNextPage`
 *                  can be derived without an extra count query)
 * @param limit     The requested page size
 * @param cursorFor Extracts the cursor payload from the last item
 */
export function buildCursorMeta<T>(
  fetched: T[],
  limit: number,
  cursorFor: (lastItem: T) => CursorPayload,
): CursorPaginationMetaDto {
  const parsedLimit = Number(limit);
  const safeLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), 100)
      : 20;
  const hasNextPage = fetched.length > safeLimit;
  const page = hasNextPage ? fetched.slice(0, safeLimit) : fetched;
  const lastItem = page.length > 0 ? page[page.length - 1] : null;

  return {
    limit: safeLimit,
    hasNextPage,
    nextCursor:
      hasNextPage && lastItem ? encodeCursor(cursorFor(lastItem)) : null,
  };
}

/**
 * Convenience: prepare a cursor page for Prisma.
 * Fetches `limit + 1` rows so `hasNextPage` can be derived without a count.
 */
export function getCursorPagination(limit?: number | null, cursor?: string) {
  const parsedLimit = Number(limit);
  const safeLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), 100)
      : 20;
  return {
    take: safeLimit + 1,
    decodedCursor: decodeCursor(cursor),
  };
}
