import {
  queuesToPoll,
  readTemporalConfig,
  TASK_QUEUES,
} from './temporal.config';

describe('readTemporalConfig', () => {
  it('is disabled with local defaults when nothing is set', () => {
    expect(readTemporalConfig({})).toEqual({
      enabled: false,
      address: 'localhost:7233',
      namespace: 'default',
      apiKey: undefined,
      tls: false,
    });
  });

  it('enables only on an explicit "true"', () => {
    expect(readTemporalConfig({ TEMPORAL_ENABLED: 'TRUE' }).enabled).toBe(true);
    expect(readTemporalConfig({ TEMPORAL_ENABLED: '1' }).enabled).toBe(false);
  });

  it('uses TLS for Cloud (API key) or when asked', () => {
    const cloud = readTemporalConfig({
      TEMPORAL_API_KEY: ' key ',
      TEMPORAL_ADDRESS: 'ns.acct.tmprl.cloud:7233',
      TEMPORAL_NAMESPACE: 'nuts-prod.acct',
    });
    expect(cloud).toMatchObject({
      apiKey: 'key',
      tls: true,
      namespace: 'nuts-prod.acct',
    });
    expect(readTemporalConfig({ TEMPORAL_TLS: 'true' }).tls).toBe(true);
  });
});

describe('queuesToPoll', () => {
  it('polls every queue by default', () => {
    expect(queuesToPoll({})).toEqual(Object.values(TASK_QUEUES));
  });

  it('accepts logical names or queue names and rejects unknown ones', () => {
    expect(
      queuesToPoll({
        TEMPORAL_TASK_QUEUES: 'payments, nuts-comms',
      }),
    ).toEqual([TASK_QUEUES.payments, TASK_QUEUES.comms]);
    expect(() => queuesToPoll({ TEMPORAL_TASK_QUEUES: 'nope' })).toThrow(
      /Unknown task queue/,
    );
  });
});
