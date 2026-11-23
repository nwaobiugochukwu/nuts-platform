import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

/**
 * Compare-and-delete: only the holder that created the lock may release it, so
 * a job that overran its TTL can never delete the lock another instance now
 * holds.
 */
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/**
 * Runs `job` only if this instance wins a distributed lock, so scheduled work
 * executes once across all API replicas instead of once per replica.
 *
 * Returns `false` (without running) when another instance holds the lock. If
 * Redis itself is unavailable the job is SKIPPED rather than run unprotected:
 * these are idempotent housekeeping tasks that can safely wait for the next
 * tick, whereas running on every replica risks duplicate work.
 */
export async function runWithCronLock(
  redis: Redis,
  key: string,
  ttlMs: number,
  job: () => Promise<void>,
): Promise<boolean> {
  const token = randomUUID();
  let acquired: string | null;
  try {
    acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  } catch {
    return false;
  }
  if (!acquired) return false;

  try {
    await job();
    return true;
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
  }
}
