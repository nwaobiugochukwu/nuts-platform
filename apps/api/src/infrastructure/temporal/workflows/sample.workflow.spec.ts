import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { SampleActivities } from '../activities/sample.activities';
import { buildActivities } from '../activities';
import {
  cancelSampleSignal,
  sampleDelayedEchoWorkflow,
} from './sample.workflow';

// Uses Temporal's time-skipping test server (downloaded on first run), so a
// multi-hour timer completes in milliseconds.
jest.setTimeout(120_000);

describe('sampleDelayedEchoWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  async function withWorker<T>(fn: () => Promise<T>): Promise<T> {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('./index'),
      activities: buildActivities(new SampleActivities()),
    });
    return worker.runUntil(fn());
  }

  it('waits out a long durable timer without real waiting, then runs the activity', async () => {
    const started = Date.now();
    const result = await withWorker(() =>
      env.client.workflow.execute(sampleDelayedEchoWorkflow, {
        args: [{ message: 'hello', delayMs: 6 * 60 * 60 * 1000 }],
        workflowId: 'sample-timer',
        taskQueue: 'test',
      }),
    );
    expect(result).toBe('echo: hello');
    expect(Date.now() - started).toBeLessThan(60_000);
  });

  it('can be cancelled by a signal before the timer fires', async () => {
    const result = await withWorker(async () => {
      const handle = await env.client.workflow.start(
        sampleDelayedEchoWorkflow,
        {
          args: [{ message: 'never', delayMs: 24 * 60 * 60 * 1000 }],
          workflowId: 'sample-cancel',
          taskQueue: 'test',
        },
      );
      await handle.signal(cancelSampleSignal);
      return handle.result();
    });
    expect(result).toBe('cancelled');
  });

  it('refuses a second start with the same workflow id while running', async () => {
    await withWorker(async () => {
      const first = await env.client.workflow.start(sampleDelayedEchoWorkflow, {
        args: [{ message: 'a', delayMs: 24 * 60 * 60 * 1000 }],
        workflowId: 'sample-dup',
        taskQueue: 'test',
      });
      await expect(
        env.client.workflow.start(sampleDelayedEchoWorkflow, {
          args: [{ message: 'b', delayMs: 1 }],
          workflowId: 'sample-dup',
          taskQueue: 'test',
        }),
      ).rejects.toThrow(/already/i);
      await first.signal(cancelSampleSignal);
      await first.result();
    });
  });
});
