import { REDACTED, buildAuditEvent, redactForAudit } from './audit-event';

describe('redactForAudit', () => {
  it('replaces secrets at any depth, whatever the key casing', () => {
    const out = redactForAudit({
      name: 'Ada',
      password: 'p',
      nested: { refreshToken: 'x', Authorization: 'Bearer y', ok: 1 },
      list: [{ otp: '123456', keep: true }],
      card_number: '4242',
      accountNumber: '0123456789',
    }) as Record<string, unknown>;
    expect(out.name).toBe('Ada');
    expect(out.password).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).refreshToken).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).Authorization).toBe(
      REDACTED,
    );
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect(((out.list as unknown[])[0] as Record<string, unknown>).otp).toBe(
      REDACTED,
    );
    expect(out.card_number).toBe(REDACTED);
    expect(out.accountNumber).toBe(REDACTED);
  });

  it('honours caller-supplied sensitive keys', () => {
    const out = redactForAudit({ nin: '123', fine: 'x' }, ['nin']) as Record<
      string,
      unknown
    >;
    expect(out.nin).toBe(REDACTED);
    expect(out.fine).toBe('x');
  });

  it('bounds strings, arrays and depth, and survives cycles and odd types', () => {
    const long = 'x'.repeat(5_000);
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const out = redactForAudit({
      long,
      many: Array.from({ length: 80 }, (_, i) => i),
      cyclic,
      big: BigInt(7),
      fn: () => 1,
      when: new Date('2026-01-01T00:00:00.000Z'),
      nan: NaN,
    }) as Record<string, unknown>;
    expect((out.long as string).length).toBeLessThan(1_100);
    expect((out.long as string).endsWith('…[truncated]')).toBe(true);
    expect((out.many as unknown[]).length).toBe(51);
    expect((out.many as unknown[])[50]).toBe('[30 more]');
    expect((out.cyclic as Record<string, unknown>).self).toBe('[circular]');
    expect(out.big).toBe('7');
    expect(out.fn).toBeNull();
    expect(out.when).toBe('2026-01-01T00:00:00.000Z');
    expect(out.nan).toBeNull();

    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 12; i += 1) deep = { child: deep };
    expect(JSON.stringify(redactForAudit(deep))).toContain('[max depth]');
  });

  it('returns null for null and undefined', () => {
    expect(redactForAudit(null)).toBeNull();
    expect(redactForAudit(undefined)).toBeNull();
  });
});

describe('buildAuditEvent', () => {
  it('fills identity and time, redacts payloads and trims the user agent', () => {
    const at = new Date('2026-11-25T10:00:00.000Z');
    const event = buildAuditEvent({
      action: 'PRODUCT_UPDATED',
      entity: 'Product',
      entityId: 'p1',
      userId: 'u1',
      userAgent: 'a'.repeat(900),
      occurredAt: at,
      payload: { token: 'secret', name: 'Shoe' },
    });
    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.occurredAt).toBe(at.toISOString());
    expect(event.userAgent).toHaveLength(500);
    expect(event.payload).toEqual({ token: REDACTED, name: 'Shoe' });
    expect(event.before).toBeUndefined();
  });

  it('keeps a supplied event id (idempotency)', () => {
    expect(
      buildAuditEvent({ action: 'A', entity: 'E', eventId: 'fixed-id' })
        .eventId,
    ).toBe('fixed-id');
  });
});
