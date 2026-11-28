import { runWithRequestId } from '@api/common/request-context/request-context.util';
import {
  auditAlso,
  auditDetails,
  currentAuditDetails,
} from '../utils/audit-details.util';

describe('auditDetails', () => {
  it('does nothing outside a request', () => {
    expect(() => auditDetails({ entityId: 'x' })).not.toThrow();
    expect(currentAuditDetails()).toBeUndefined();
  });

  it('collects details for the request being served', async () => {
    await runWithRequestId('req-details-01', async () => {
      auditDetails({ entityId: 'c1', payload: { name: 'Shoes' } });
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(currentAuditDetails()).toEqual({
        entityId: 'c1',
        payload: { name: 'Shoes' },
      });
    });
  });

  it('merges several calls: payload keys combine, other fields take the latest', () => {
    runWithRequestId('req-details-02', () => {
      auditDetails({ entityId: 'a', payload: { one: 1 }, before: { v: 1 } });
      auditDetails({ entityId: 'b', payload: { two: 2 }, after: { v: 2 } });
      expect(currentAuditDetails()).toEqual({
        entityId: 'b',
        payload: { one: 1, two: 2 },
        before: { v: 1 },
        after: { v: 2 },
      });
    });
  });

  it('keeps concurrent requests apart', async () => {
    const seen = await Promise.all(
      ['one', 'two'].map((id, i) =>
        runWithRequestId(`req-details-${id}-xx`, async () => {
          auditDetails({ entityId: id });
          await new Promise((resolve) => setTimeout(resolve, 20 - i * 10));
          return currentAuditDetails()?.entityId;
        }),
      ),
    );
    expect(seen).toEqual(['one', 'two']);
  });
});

describe('auditAlso', () => {
  it('does nothing outside a request', () => {
    expect(() => auditAlso({ action: 'X', entity: 'E' })).not.toThrow();
  });

  it('adds extra events and keeps them when more details arrive', () => {
    runWithRequestId('req-also-0001', () => {
      auditAlso({
        action: 'USER_AUTO_UNSUSPEND_EXPIRED',
        entity: 'User',
        entityId: 'u1',
      });
      auditDetails({ entityId: 'u1', payload: { a: 1 } });
      auditAlso({ action: 'SECOND', entity: 'User' });
      expect(currentAuditDetails()?.extra?.map((e) => e.action)).toEqual([
        'USER_AUTO_UNSUSPEND_EXPIRED',
        'SECOND',
      ]);
      expect(currentAuditDetails()?.entityId).toBe('u1');
    });
  });
});
