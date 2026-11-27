import {
  OUTBOX_MAX_ATTEMPTS,
  isOutboxExhausted,
  outboxRetryDelayMs,
} from './outbox-backoff.util';

describe('outbox backoff', () => {
  it('doubles the delay each attempt, from 5 s', () => {
    expect([1, 2, 3, 4].map((n) => outboxRetryDelayMs(n, () => 1))).toEqual([
      5_000, 10_000, 20_000, 40_000,
    ]);
  });

  it('never waits more than 15 minutes', () => {
    expect(outboxRetryDelayMs(30, () => 1)).toBe(15 * 60_000);
  });

  it('jitters between half and all of the delay', () => {
    expect(outboxRetryDelayMs(3, () => 0)).toBe(10_000);
    expect(outboxRetryDelayMs(3, () => 1)).toBe(20_000);
  });

  it('declares a row exhausted at the maximum number of attempts', () => {
    expect(isOutboxExhausted(OUTBOX_MAX_ATTEMPTS - 1)).toBe(false);
    expect(isOutboxExhausted(OUTBOX_MAX_ATTEMPTS)).toBe(true);
  });
});
