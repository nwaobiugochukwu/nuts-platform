import {
  HEARTBEAT_STALE_SECONDS,
  HeartbeatService,
  evaluateBackground,
  heartbeatTargets,
  stateFromAge,
} from './heartbeat.service';

const env = (role?: string) => ({ PROCESS_ROLE: role }) as NodeJS.ProcessEnv;

describe('heartbeatTargets', () => {
  it('maps each role to the programs it provides', () => {
    expect(heartbeatTargets(env('api'))).toEqual([]);
    expect(heartbeatTargets(env('worker'))).toEqual(['worker']);
    expect(heartbeatTargets(env('jobs'))).toEqual(['jobs']);
    expect(heartbeatTargets(env('all'))).toEqual(['worker', 'jobs']);
    expect(heartbeatTargets(env(undefined))).toEqual(['worker', 'jobs']);
  });
});

describe('stateFromAge', () => {
  it('is missing without a heartbeat, stale when old, up when recent', () => {
    expect(stateFromAge(null)).toBe('missing');
    expect(stateFromAge(HEARTBEAT_STALE_SECONDS + 1)).toBe('stale');
    expect(stateFromAge(10)).toBe('up');
  });
});

describe('evaluateBackground', () => {
  const healthyQueues = [
    { queue: 'q.nuts.emails', consumers: 1 },
    { queue: 'q.nuts.dlq', consumers: 0 },
  ];

  it('is ok when both programs beat and every work queue has a consumer', () => {
    const status = evaluateBackground({
      ages: { worker: 5, jobs: 12 },
      queueStats: healthyQueues,
    });
    expect(status.ok).toBe(true);
    expect(status.problems).toEqual([]);
  });

  it('does not require a consumer on queues that are off on purpose', () => {
    const status = evaluateBackground({
      ages: { worker: 1, jobs: 1 },
      queueStats: [
        { queue: 'q.nuts.emails', consumers: 1 },
        { queue: 'q.nuts.workflows', consumers: 0 },
      ],
      ignoreQueues: ['q.nuts.workflows'],
    });
    expect(status.ok).toBe(true);
  });

  it('never counts the dead-letter queue as needing a consumer', () => {
    expect(
      evaluateBackground({
        ages: { worker: 1, jobs: 1 },
        queueStats: healthyQueues,
      }).queuesWithoutConsumers,
    ).toEqual([]);
  });

  it('says plainly what is not running when a program is missing', () => {
    const status = evaluateBackground({
      ages: { worker: null, jobs: 5 },
      queueStats: [{ queue: 'q.nuts.emails', consumers: 0 }],
    });
    expect(status.ok).toBe(false);
    expect(status.heartbeats.worker.state).toBe('missing');
    expect(status.problems.join(' ')).toMatch(/worker is missing/);
    expect(status.problems.join(' ')).toMatch(
      /no consumer on: q\.nuts\.emails/,
    );
  });

  it('flags jobs separately and ignores queue stats when the broker is unreachable', () => {
    const status = evaluateBackground({
      ages: { worker: 3, jobs: 500 },
      queueStats: null,
    });
    expect(status.ok).toBe(false);
    expect(status.problems).toHaveLength(1);
    expect(status.problems[0]).toMatch(/jobs is stale.*scheduled jobs/);
  });
});

describe('HeartbeatService', () => {
  const original = process.env.PROCESS_ROLE;
  afterEach(() => {
    if (original === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = original;
    jest.useRealTimers();
  });

  it('writes a heartbeat for each program it provides and reads its age', async () => {
    process.env.PROCESS_ROLE = 'all';
    const store = new Map<string, string>();
    const redis = {
      set: jest.fn((k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      }),
      get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    };
    const service = new HeartbeatService(redis as never, undefined);
    service.onApplicationBootstrap();
    await new Promise((resolve) => setImmediate(resolve));
    expect([...store.keys()].sort()).toEqual([
      'nuts:heartbeat:jobs',
      'nuts:heartbeat:worker',
    ]);
    expect(redis.set).toHaveBeenCalledWith(
      'nuts:heartbeat:worker',
      expect.any(String),
      'EX',
      120,
    );
    expect(await service.age('worker')).toBeLessThan(2);
    service.onModuleDestroy();
  });

  it('the api writes nothing but reports missing programs', async () => {
    process.env.PROCESS_ROLE = 'api';
    const redis = { set: jest.fn(), get: jest.fn().mockResolvedValue(null) };
    const service = new HeartbeatService(redis as never, undefined);
    service.onApplicationBootstrap();
    expect(redis.set).not.toHaveBeenCalled();
    const status = await service.status();
    expect(status.ok).toBe(false);
    expect(status.heartbeats.worker.state).toBe('missing');
    service.onModuleDestroy();
  });

  it('degrades quietly when Redis is unreachable', async () => {
    const redis = { get: jest.fn().mockRejectedValue(new Error('down')) };
    const service = new HeartbeatService(redis as never, undefined);
    expect(await service.age('jobs')).toBeNull();
  });
});
