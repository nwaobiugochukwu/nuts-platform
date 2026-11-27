import { buildWorkerHealth } from './role-runtime.util';

describe('buildWorkerHealth', () => {
  const base = {
    role: 'worker' as const,
    uptimeSeconds: 12,
    startedAt: new Date('2026-11-25T10:00:00.000Z'),
  };

  it('is ok when the broker is up', () => {
    expect(
      buildWorkerHealth({
        ...base,
        brokerRequired: true,
        brokerAvailable: true,
      }),
    ).toMatchObject({ status: 'ok', checks: { broker: 'up' } });
  });

  it('is degraded when a required broker is down', () => {
    expect(
      buildWorkerHealth({
        ...base,
        brokerRequired: true,
        brokerAvailable: false,
      }),
    ).toMatchObject({ status: 'degraded', checks: { broker: 'down' } });
  });

  it('does not need the broker when it is disabled', () => {
    expect(
      buildWorkerHealth({
        ...base,
        role: 'jobs',
        brokerRequired: false,
        brokerAvailable: false,
      }),
    ).toMatchObject({ status: 'ok', checks: { broker: 'not_required' } });
  });
});
