import type { Prisma } from '@prisma/client';
import type { StartWorkflowInput } from '../workflows/temporal-client.service';
import type {
  TransactionContext,
  TransactionOptions,
  TransactionRunnerService,
} from './transaction-runner.service';

/**
 * Test double for `TransactionRunnerService`. Runs the callback against the supplied
 * (usually mocked) transaction client, then runs `afterCommit` hooks on
 * success or `afterRollback` hooks on failure. Records every call by name.
 */
export class FakeTransactionRunner implements Pick<
  TransactionRunnerService,
  'run'
> {
  readonly runs: string[] = [];
  readonly emitted: Array<{
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }> = [];

  readonly audited: Array<Record<string, unknown>> = [];
  readonly workflows: StartWorkflowInput[] = [];

  constructor(private readonly tx: unknown = {}) {}

  async run<T>(
    fn: (ctx: TransactionContext) => Promise<T>,
    options: TransactionOptions,
  ): Promise<T> {
    this.runs.push(options.name);
    const commit: Array<() => void | Promise<void>> = [];
    const rollback: Array<() => void | Promise<void>> = [];
    const ctx: TransactionContext = {
      tx: (options.parent ?? this.tx) as Prisma.TransactionClient,
      emit: (aggregateType, aggregateId, eventType, payload) => {
        this.emitted.push({ aggregateType, aggregateId, eventType, payload });
        return Promise.resolve();
      },
      audit: (input) => {
        this.audited.push(input);
        return Promise.resolve();
      },
      startWorkflow: (input) => {
        this.workflows.push(input);
        return Promise.resolve();
      },
      afterCommit: (hook) => {
        commit.push(hook);
      },
      afterRollback: (hook) => {
        rollback.push(hook);
      },
    };
    try {
      const result = await fn(ctx);
      for (const hook of commit) await hook();
      return result;
    } catch (error) {
      for (const hook of rollback) await hook();
      throw error;
    }
  }
}
