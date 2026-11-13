import { getPagination } from './pagination.util';
import { getCursorPagination, buildCursorMeta } from './cursor-pagination.util';

describe('Pagination & Query Performance Safeguards', () => {
  describe('getPagination (Offset-based Performance & Bounds)', () => {
    /*
     * [Performance / Full-Table Scan Prevention]
     * Capping limit prevents malicious or accidental limit=100000 queries
     * that exhaust database memory and cause 10,000ms+ response times.
     */
    it('clamps excessive limit to safe maximum (100) to protect DB memory', () => {
      const result = getPagination(1, 50000);
      expect(result.take).toBe(100);
      expect(result.skip).toBe(0);
    });

    /*
     * [Performance / Invalid Input Resilience]
     * When page or limit are undefined, NaN, or non-numeric,
     * defaults must be applied instead of returning NaN (which crashes Prisma).
     */
    it('gracefully handles undefined, null, and NaN without producing NaN queries', () => {
      const fromUndefined = getPagination(undefined, undefined);
      expect(fromUndefined.skip).toBe(0);
      expect(fromUndefined.take).toBe(20);

      const fromNaN = getPagination(NaN, NaN);
      expect(fromNaN.skip).toBe(0);
      expect(fromNaN.take).toBe(20);

      const fromNull = getPagination(null, null);
      expect(fromNull.skip).toBe(0);
      expect(fromNull.take).toBe(20);
    });

    /*
     * [Performance / Negative Bounds Safeguard]
     * Negative pages and negative limits must clamp to page 1 and limit 20.
     */
    it('clamps negative or zero page and limit to safe defaults', () => {
      const result = getPagination(-5, 0);
      expect(result.skip).toBe(0);
      expect(result.take).toBe(20);
    });

    /*
     * [Performance / Offset Calculation]
     * Ensures deterministic offset math: skip = (page - 1) * limit
     */
    it('calculates standard pagination correctly', () => {
      const result = getPagination(3, 25);
      expect(result.skip).toBe(50);
      expect(result.take).toBe(25);
    });
  });

  describe('getCursorPagination (High-scale Keyspace Performance)', () => {
    /*
     * [Performance / Deep-Paging Scan Elimination]
     * Cursor pagination avoids OFFSET N table scans on millions of rows.
     * Limit must still be capped to 100 to bound data transfer.
     */
    it('caps cursor fetch limit to 100 (+1 for next-page peek)', () => {
      const result = getCursorPagination(1000);
      expect(result.take).toBe(101);
    });

    /*
     * [Performance / Cursor Robustness]
     * Handles undefined and invalid limits safely without producing NaN.
     */
    it('handles undefined or NaN limits gracefully with default 20 (+1 peek)', () => {
      const result = getCursorPagination(undefined);
      expect(result.take).toBe(21);

      const nanResult = getCursorPagination(NaN);
      expect(nanResult.take).toBe(21);
    });

    /*
     * [Performance / Next Page Evaluation]
     * Verifies that fetching limit + 1 determines hasNextPage without
     * issuing an expensive secondary SELECT COUNT(*) query.
     */
    it('derives hasNextPage without secondary count query', () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        id: `prod-${i + 1}`,
        createdAt: new Date(),
      }));

      const meta = buildCursorMeta(items, 20, (item) => ({
        id: item.id,
      }));

      expect(meta.hasNextPage).toBe(true);
      expect(meta.limit).toBe(20);
      expect(meta.nextCursor).toBeDefined();
    });
  });
});
