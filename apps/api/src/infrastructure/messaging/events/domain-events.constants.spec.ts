import { DomainEvents } from './domain-events.constants';
import { isValidEventType } from './event-envelope.util';

describe('the domain event catalog', () => {
  const entries = Object.entries(DomainEvents);

  it.each(entries)('%s is named <aggregate>.<fact>', (_key, type) => {
    expect(isValidEventType(type)).toBe(true);
  });

  it('names no event twice', () => {
    const types = entries.map(([, type]) => type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('names each constant after its event, so the key and the value cannot drift apart', () => {
    for (const [key, type] of entries) {
      expect(key).toBe(type.replace('.', '_').toUpperCase());
    }
  });

  it('covers the whole catalog (about 70 events)', () => {
    expect(entries.length).toBeGreaterThanOrEqual(70);
  });
});
