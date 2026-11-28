import {
  currentProcessRole,
  parseProcessRole,
  portFor,
  roleCan,
} from './process-role.config';

describe('process role', () => {
  it('defaults to running everything', () => {
    expect(parseProcessRole(undefined)).toBe('all');
    expect(parseProcessRole('  ')).toBe('all');
    expect(roleCan('http', {})).toBe(true);
    expect(roleCan('consumers', {})).toBe(true);
    expect(roleCan('crons', {})).toBe(true);
  });

  it('is case-insensitive and rejects unknown roles', () => {
    expect(parseProcessRole('Worker')).toBe('worker');
    expect(() => parseProcessRole('cron')).toThrow(/Invalid PROCESS_ROLE/);
  });

  it('gives each role only its own capabilities', () => {
    const env = (role: string) => ({ PROCESS_ROLE: role }) as NodeJS.ProcessEnv;
    expect(roleCan('http', env('api'))).toBe(true);
    expect(roleCan('consumers', env('api'))).toBe(false);
    expect(roleCan('crons', env('api'))).toBe(false);

    expect(roleCan('consumers', env('worker'))).toBe(true);
    expect(roleCan('http', env('worker'))).toBe(false);
    expect(roleCan('crons', env('worker'))).toBe(false);

    expect(roleCan('crons', env('jobs'))).toBe(true);
    expect(roleCan('consumers', env('jobs'))).toBe(false);
    expect(roleCan('http', env('jobs'))).toBe(false);
  });

  it('reads the role from the environment', () => {
    expect(currentProcessRole({ PROCESS_ROLE: 'jobs' })).toBe('jobs');
  });
});

describe('portFor', () => {
  const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

  it('gives worker, jobs and the temporal worker their own health ports by default', () => {
    expect(portFor('health', 'worker', env({}))).toBe(3002);
    expect(portFor('health', 'jobs', env({}))).toBe(3003);
    expect(portFor('health', 'workflow-worker', env({}))).toBe(3004);
    expect(portFor('health', 'api', env({}))).toBeNull();
  });

  it('turns metrics on by default only in development', () => {
    expect(portFor('metrics', 'api', env({ NODE_ENV: 'development' }))).toBe(
      9464,
    );
    expect(portFor('metrics', 'worker', env({ NODE_ENV: 'development' }))).toBe(
      9465,
    );
    expect(portFor('metrics', 'jobs', env({ NODE_ENV: 'development' }))).toBe(
      9466,
    );
    expect(
      portFor('metrics', 'workflow-worker', env({ NODE_ENV: 'development' })),
    ).toBe(9467);
    expect(
      portFor('metrics', 'api', env({ NODE_ENV: 'production' })),
    ).toBeNull();
    expect(portFor('metrics', 'api', env({}))).toBeNull();
  });

  it('lets one env file give each program its own port', () => {
    const shared = env({
      WORKER_HEALTH_PORT: '4002',
      JOBS_HEALTH_PORT: '4003',
    });
    expect(portFor('health', 'worker', shared)).toBe(4002);
    expect(portFor('health', 'jobs', shared)).toBe(4003);
  });

  it('uses the plain {KIND}_PORT for a single deployed service, below the per-program value', () => {
    expect(portFor('health', 'worker', env({ HEALTH_PORT: '8080' }))).toBe(
      8080,
    );
    expect(
      portFor(
        'health',
        'worker',
        env({ HEALTH_PORT: '8080', WORKER_HEALTH_PORT: '4002' }),
      ),
    ).toBe(4002);
    expect(portFor('metrics', 'api', env({ METRICS_PORT: '9100' }))).toBe(9100);
  });

  it('lets a staging service switch metrics on without NODE_ENV=development', () => {
    expect(
      portFor(
        'metrics',
        'worker',
        env({ NODE_ENV: 'production', METRICS_PORT: '9100' }),
      ),
    ).toBe(9100);
  });

  it('treats the all program like the api for per-program keys', () => {
    expect(portFor('metrics', 'all', env({ API_METRICS_PORT: '9777' }))).toBe(
      9777,
    );
    expect(
      portFor(
        'metrics',
        'all',
        env({ ALL_METRICS_PORT: '9888', API_METRICS_PORT: '9777' }),
      ),
    ).toBe(9888);
  });

  it('names the variable when a port is invalid', () => {
    expect(() =>
      portFor('health', 'worker', env({ WORKER_HEALTH_PORT: 'abc' })),
    ).toThrow(/WORKER_HEALTH_PORT/);
    expect(() =>
      portFor('metrics', 'api', env({ METRICS_PORT: '70000' })),
    ).toThrow(/METRICS_PORT/);
  });

  it('ignores blank values', () => {
    expect(
      portFor(
        'health',
        'worker',
        env({ WORKER_HEALTH_PORT: '  ', HEALTH_PORT: '' }),
      ),
    ).toBe(3002);
  });
});
