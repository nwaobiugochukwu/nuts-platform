import {
  CIRCUIT_WAIT_MS,
  MAX_CIRCUIT_WAITS,
  PermanentConsumerError,
  RETRY_DELAYS_MS,
  classifyFailure,
  decideFailure,
  retryDelaysFor,
  retryQueueName,
} from './consumer-retry.util';

const named = (name: string) => Object.assign(new Error('x'), { name });

describe('classifyFailure', () => {
  it('sends unreadable and malformed messages straight to dead letter', () => {
    expect(classifyFailure(new PermanentConsumerError('bad'))).toBe(
      'permanent',
    );
    expect(classifyFailure(new SyntaxError('Unexpected token'))).toBe(
      'permanent',
    );
    expect(classifyFailure(named('PrismaClientValidationError'))).toBe(
      'permanent',
    );
  });

  it('treats an open breaker as a wait, not a failure of the message', () => {
    expect(classifyFailure(named('BrokenCircuitError'))).toBe('circuit-open');
  });

  it('treats everything else, including non-errors, as transient', () => {
    expect(classifyFailure(new Error('connection reset'))).toBe('transient');
    expect(classifyFailure(named('TimeoutError'))).toBe('transient');
    expect(classifyFailure('boom')).toBe('transient');
  });
});

describe('decideFailure', () => {
  it('walks the retry delays in order, then dead-letters', () => {
    const error = new Error('db down');
    expect(decideFailure(error, 0)).toMatchObject({
      action: 'retry',
      delayMs: RETRY_DELAYS_MS[0],
      attempt: 1,
    });
    expect(decideFailure(error, 1)).toMatchObject({
      delayMs: RETRY_DELAYS_MS[1],
      attempt: 2,
    });
    expect(decideFailure(error, 2)).toMatchObject({
      delayMs: RETRY_DELAYS_MS[2],
      attempt: 3,
    });
    expect(decideFailure(error, 3)).toEqual({
      action: 'dead',
      reason: 'retries-exhausted',
    });
  });

  it('never retries a permanent failure', () => {
    expect(decideFailure(new PermanentConsumerError('bad'), 0)).toEqual({
      action: 'dead',
      reason: 'permanent',
    });
  });

  it('waits on an open breaker without spending a retry', () => {
    expect(decideFailure(named('BrokenCircuitError'), 2, 4)).toEqual({
      action: 'retry',
      delayMs: CIRCUIT_WAIT_MS,
      attempt: 2,
      circuitWaits: 5,
    });
  });

  it('after waiting long enough on a breaker, counts it as an ordinary failure', () => {
    expect(
      decideFailure(named('BrokenCircuitError'), 0, MAX_CIRCUIT_WAITS),
    ).toMatchObject({ action: 'retry', delayMs: RETRY_DELAYS_MS[0] });
    expect(
      decideFailure(named('BrokenCircuitError'), 3, MAX_CIRCUIT_WAITS),
    ).toEqual({ action: 'dead', reason: 'retries-exhausted' });
  });
});

describe('retry queue names', () => {
  it('names a queue by its delay', () => {
    expect(retryQueueName('q.nuts.emails', 10_000)).toBe(
      'q.nuts.emails.retry.10s',
    );
    expect(retryQueueName('q.nuts.emails', 60_000)).toBe(
      'q.nuts.emails.retry.1m',
    );
    expect(retryQueueName('q.nuts.emails', 600_000)).toBe(
      'q.nuts.emails.retry.10m',
    );
  });

  it('needs a queue for each retry delay and no duplicate for the circuit wait', () => {
    expect(retryDelaysFor()).toEqual([10_000, 60_000, 600_000]);
  });
});
