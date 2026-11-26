import { currentProcessRole, parseProcessRole, roleCan } from './process-role';

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
