import {
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
  condition,
} from '@temporalio/workflow';
import type { SampleActivities } from '../activities/sample.activities';

/**
 * A template for real workflows (workflow files may import only
 * `@temporalio/workflow` and pure helpers; all I/O lives in activities).
 * It shows the four building blocks the planned workflows use: a durable timer,
 * an activity with a retry policy, a signal, and a query-free deterministic body.
 */
export interface SampleInput {
  message: string;
  delayMs: number;
}

export const cancelSampleSignal = defineSignal('cancelSample');

const { echo } = proxyActivities<SampleActivities>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 3, initialInterval: '1 second' },
});

export async function sampleDelayedEchoWorkflow(
  input: SampleInput,
): Promise<string> {
  let cancelled = false;
  setHandler(cancelSampleSignal, () => {
    cancelled = true;
  });

  // Wait for the delay OR a cancel signal, whichever comes first. The timer is
  // durable: it survives worker restarts and deploys.
  const wasCancelled = await Promise.race([
    sleep(input.delayMs).then(() => false),
    condition(() => cancelled).then(() => true),
  ]);
  if (wasCancelled) return 'cancelled';

  return echo(input.message);
}
