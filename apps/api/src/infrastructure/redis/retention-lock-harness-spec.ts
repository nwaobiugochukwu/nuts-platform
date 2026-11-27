// Test helper (name ends in "spec.ts": excluded from the build, not run by Jest).
// Redis stand-in for the retention jobs that renew and release their own lock with Lua scripts.
import type Redis from 'ioredis';

export function fakeRetentionRedis(
  options: {
    alreadyLocked?: boolean;
    setFails?: boolean;
    lockLostOnRenew?: boolean;
    releaseFails?: boolean;
  } = {},
) {
  const set = jest.fn(() => {
    if (options.setFails) return Promise.reject(new Error('redis down'));
    return Promise.resolve(options.alreadyLocked ? null : 'OK');
  });
  const evalScript = jest.fn((script: string) => {
    if (script.includes("'expire'")) {
      return Promise.resolve(options.lockLostOnRenew ? 0 : 1);
    }
    if (options.releaseFails) return Promise.reject(new Error('redis down'));
    return Promise.resolve(1);
  });
  const isRelease = (call: unknown[]) => String(call[0]).includes("'del'");
  return {
    redis: { set, eval: evalScript } as unknown as Redis,
    set,
    evalScript,
    releases: () => evalScript.mock.calls.filter(isRelease).length,
    renewals: () =>
      evalScript.mock.calls.filter((call) => !isRelease(call)).length,
  };
}
