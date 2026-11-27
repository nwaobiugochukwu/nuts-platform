import {
  MAX_REPLAYS,
  REPLAY_COUNT_HEADER,
  describeDeadLetter,
  planReplay,
  type DeadLetterMessage,
} from './dlq.util';

function message(
  body: unknown,
  headers: Record<string, unknown> = {},
): DeadLetterMessage {
  return {
    content: Buffer.from(
      typeof body === 'string' ? body : JSON.stringify(body),
    ),
    properties: { headers },
  };
}

const death = (extra: Record<string, unknown> = {}) => ({
  'x-death': [
    {
      queue: 'q.nuts.emails',
      reason: 'rejected',
      count: 2,
      'routing-keys': ['email.dispatch'],
    },
  ],
  'x-first-death-queue': 'q.nuts.emails',
  'x-first-death-reason': 'rejected',
  'x-request-id': 'req-dlq-0001',
  ...extra,
});

describe('describeDeadLetter', () => {
  it('reads where a message came from and why it failed', () => {
    const info = describeDeadLetter(message({ to: 'a@b.c' }, death()));
    expect(info).toMatchObject({
      originalQueue: 'q.nuts.emails',
      routingKey: 'email.dispatch',
      reason: 'rejected',
      deaths: 2,
      replays: 0,
      requestId: 'req-dlq-0001',
    });
  });

  it('redacts secrets and truncates the preview', () => {
    const info = describeDeadLetter(
      message({ to: 'a@b.c', token: 'abc', note: 'x'.repeat(2_000) }, death()),
    );
    expect(info.preview).toContain('[REDACTED]');
    expect(info.preview).not.toContain('"abc"');
    expect(info.preview.length).toBeLessThanOrEqual(301);
  });

  it('copes with bodies that are not JSON and messages with no death header', () => {
    const info = describeDeadLetter(message('not json'));
    expect(info.preview).toBe('[not JSON]');
    expect(info.originalQueue).toBeNull();
    expect(info.routingKey).toBeNull();
  });
});

describe('planReplay', () => {
  it('republishes to the events exchange with the original routing key', () => {
    const plan = planReplay(message({ a: 1 }, death()));
    expect(plan).toMatchObject({
      allowed: true,
      exchange: 'nuts.events',
      routingKey: 'email.dispatch',
    });
    if (plan.allowed) {
      expect(plan.headers[REPLAY_COUNT_HEADER]).toBe(1);
      expect(plan.headers['x-request-id']).toBe('req-dlq-0001');
      expect(plan.headers['x-death']).toBeUndefined();
      expect(plan.headers['x-first-death-queue']).toBeUndefined();
    }
  });

  it('refuses a message with no original routing key', () => {
    expect(planReplay(message({}))).toMatchObject({ allowed: false });
  });

  it('stops replaying a poison message unless forced', () => {
    const poisoned = message({}, death({ [REPLAY_COUNT_HEADER]: MAX_REPLAYS }));
    expect(planReplay(poisoned)).toMatchObject({ allowed: false });
    expect(planReplay(poisoned, { force: true })).toMatchObject({
      allowed: true,
    });
  });
});
