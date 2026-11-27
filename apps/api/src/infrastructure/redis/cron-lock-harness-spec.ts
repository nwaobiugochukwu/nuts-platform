// Test helper (name ends in "spec.ts": excluded from the build, not run by Jest).
// A stand-in for Redis that understands only what runWithCronLock uses.
import type Redis from 'ioredis';

export function fakeCronRedis(
  options: { alreadyLocked?: boolean; setFails?: boolean } = {},
) {
  const set = jest.fn(() => {
    if (options.setFails) return Promise.reject(new Error('redis down'));
    return Promise.resolve(options.alreadyLocked ? null : 'OK');
  });
  const evalScript = jest.fn().mockResolvedValue(1);
  return {
    redis: { set, eval: evalScript } as unknown as Redis,
    set,
    evalScript,
  };
}
