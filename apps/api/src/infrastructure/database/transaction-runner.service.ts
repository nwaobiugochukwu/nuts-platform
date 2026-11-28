import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { setTimeout as sleep } from 'node:timers/promises';
import { PrismaService } from './prisma.service';
import { OutboxService } from '../messaging/outbox/outbox.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import type { StartWorkflowInput } from '../workflows/workflow-client.service';
import { RABBITMQ_ROUTING_KEYS } from '../messaging/rabbitmq/rabbitmq.constants';
import { currentProcessRole } from '../../config/process-role.config';
import {
  buildAuditEvent,
  type BuildAuditEventInput,
} from '@api/infrastructure/messaging/events/audit-event.util';
import type { PublishEventInput } from '@api/infrastructure/messaging/events/event-envelope.types';

export type TransactionPreset = 'default' | 'short' | 'critical';

export type TransactionIsolation =
  | 'ReadCommitted'
  | 'RepeatableRead'
  | 'Serializable';

export interface TransactionOptions {
  /** Stable name used in logs (and metrics later), e.g. `order.settle`. */
  name: string;
  /**
   * `default`: 15 s. `short`: 5 s. `critical`: Serializable, retried on write
   * conflicts. Individual options below override the preset.
   */
  preset?: TransactionPreset;
  timeoutMs?: number;
  maxWaitMs?: number;
  isolation?: TransactionIsolation;
  /** Extra attempts after the first when the database reports a conflict. */
  retries?: number;
  /**
   * Join a transaction that is already open instead of starting a nested one.
   * The callback then runs inside the parent: it shares its commit, its
   * isolation and its timeout, and hooks wait for the parent's outcome.
   */
  parent?: Prisma.TransactionClient;
}

export interface TransactionContext {
  /** A normal Prisma transaction client. Pass it to services that must take part. */
  readonly tx: Prisma.TransactionClient;
  /**
   * Appends an outbox event in this transaction. The relay is woken only after
   * the transaction commits, never from inside it.
   */
  emit(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  /**
   * Publishes a domain event in the standard envelope, in this transaction: it exists if and only
   * if the change does, and is never sent for a change that rolled back. Prefer this over `emit`.
   */
  publish<T extends object>(input: PublishEventInput<T>): Promise<void>;
  /**
   * Records a critical audit event in this transaction (outbox), so it exists
   * if and only if the change does. Use for money, permissions and sign-in;
   * everything else can use `AuditLogService.log`.
   */
  audit(input: Omit<BuildAuditEventInput, 'eventId' | 'source'>): Promise<void>;
  /**
   * Starts a Temporal workflow when (and only when) this transaction commits:
   * the request is written to the outbox, and a worker starts it. The workflow
   * id is the business key, so retries and redeliveries never start it twice.
   */
  startWorkflow(input: StartWorkflowInput): Promise<void>;
  /** Runs once, in order, after COMMIT. A failing hook never fails the work. */
  afterCommit(hook: () => void | Promise<void>): void;
  /** Runs once, in order, after the transaction (and all retries) rolled back. */
  afterRollback(hook: () => void | Promise<void>): void;
}

type Hook = () => void | Promise<void>;

interface HookRegistry {
  commit: Hook[];
  rollback: Hook[];
}

interface ResolvedOptions {
  timeoutMs: number;
  maxWaitMs: number;
  isolation: TransactionIsolation;
  retries: number;
}

export const SLOW_TRANSACTION_MS = 2_000;

const PRESETS: Record<TransactionPreset, ResolvedOptions> = {
  default: {
    timeoutMs: 15_000,
    maxWaitMs: 5_000,
    isolation: 'ReadCommitted',
    retries: 0,
  },
  short: {
    timeoutMs: 5_000,
    maxWaitMs: 3_000,
    isolation: 'ReadCommitted',
    retries: 0,
  },
  critical: {
    timeoutMs: 15_000,
    maxWaitMs: 5_000,
    isolation: 'Serializable',
    retries: 3,
  },
};

const ISOLATION: Record<
  TransactionIsolation,
  Prisma.TransactionIsolationLevel
> = {
  ReadCommitted: Prisma.TransactionIsolationLevel.ReadCommitted,
  RepeatableRead: Prisma.TransactionIsolationLevel.RepeatableRead,
  Serializable: Prisma.TransactionIsolationLevel.Serializable,
};

export function resolveTransactionOptions(
  options: Pick<
    TransactionOptions,
    'preset' | 'timeoutMs' | 'maxWaitMs' | 'isolation' | 'retries'
  >,
): ResolvedOptions {
  const base = PRESETS[options.preset ?? 'default'];
  return {
    timeoutMs: options.timeoutMs ?? base.timeoutMs,
    maxWaitMs: options.maxWaitMs ?? base.maxWaitMs,
    isolation: options.isolation ?? base.isolation,
    retries: Math.max(0, options.retries ?? base.retries),
  };
}

/**
 * True for failures where re-running the whole transaction is the correct
 * response: write conflicts, serialization failures and deadlocks.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return true;
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '40001' || code === '40P01') return true;
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  return (
    message.includes('could not serialize access') ||
    message.includes('deadlock detected') ||
    message.includes('write conflict or a deadlock')
  );
}

/** Jittered exponential backoff: roughly 25-50 ms, 50-100 ms, 100-200 ms... */
export function transactionBackoffMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const base = 25 * 2 ** Math.max(0, attempt - 1);
  return Math.round(base + random() * base);
}

async function runHooks(
  hooks: Hook[],
  name: string,
  logger: Logger,
  phase: string,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook();
    } catch (error) {
      // The database outcome is already decided; never turn it into an error.
      logger.error(
        `Transaction "${name}" ${phase} hook failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * The one place that opens database transactions.
 *
 *   await this.tx.run(async (ctx) => {
 *     await this.wallet.settle(vendorId, amount, orderId, ctx.tx);
 *     await ctx.emit('order', orderId, 'order.settled', { orderId });
 *     ctx.afterCommit(() => this.cache.invalidateVendor(vendorId));
 *   }, { name: 'order.settle', preset: 'critical' });
 *
 * The callback may run more than once (conflict retries), so it must not call
 * external services or send messages directly. Do that in `afterCommit`.
 */
@Injectable()
export class TransactionRunnerService {
  private readonly logger = new Logger(TransactionRunnerService.name);
  /** Hooks of transactions this runner opened, so joined callers can defer to them. */
  private readonly open = new WeakMap<object, HookRegistry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async run<T>(
    fn: (ctx: TransactionContext) => Promise<T>,
    options: TransactionOptions,
  ): Promise<T> {
    if (options.parent) {
      return this.join(fn, options.parent, options.name);
    }

    const resolved = resolveTransactionOptions(options);
    const startedAt = Date.now();
    let attempt = 0;

    for (;;) {
      attempt += 1;
      const hooks: HookRegistry = { commit: [], rollback: [] };
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            this.open.set(tx, hooks);
            return fn(this.contextFor(tx, hooks));
          },
          {
            isolationLevel: ISOLATION[resolved.isolation],
            maxWait: resolved.maxWaitMs,
            timeout: resolved.timeoutMs,
          },
        );
        this.reportDuration(options.name, startedAt, attempt);
        this.metrics?.observeTransaction(
          options.name,
          'commit',
          (Date.now() - startedAt) / 1000,
        );
        await runHooks(hooks.commit, options.name, this.logger, 'afterCommit');
        return result;
      } catch (error) {
        const canRetry =
          isRetryableTransactionError(error) && attempt <= resolved.retries;
        if (canRetry) {
          this.logger.warn(
            `Transaction "${options.name}" conflicted; retrying attempt ${
              attempt + 1
            }/${resolved.retries + 1}`,
          );
          this.metrics?.countTransactionRetry(options.name);
          await sleep(transactionBackoffMs(attempt));
          continue;
        }
        this.metrics?.observeTransaction(
          options.name,
          'rollback',
          (Date.now() - startedAt) / 1000,
        );
        await runHooks(
          hooks.rollback,
          options.name,
          this.logger,
          'afterRollback',
        );
        throw error;
      }
    }
  }

  private async join<T>(
    fn: (ctx: TransactionContext) => Promise<T>,
    parent: Prisma.TransactionClient,
    name: string,
  ): Promise<T> {
    const hooks = this.open.get(parent);
    if (!hooks) {
      // A transaction we did not open: we cannot know when it commits, so
      // refuse hooks rather than run them too early.
      const context = this.contextFor(parent, {
        commit: [],
        rollback: [],
      });
      return fn({
        ...context,
        afterCommit: () => {
          throw new Error(
            `Transaction "${name}" joined a transaction not opened by TransactionRunnerService; afterCommit is unavailable.`,
          );
        },
        afterRollback: () => {
          throw new Error(
            `Transaction "${name}" joined a transaction not opened by TransactionRunnerService; afterRollback is unavailable.`,
          );
        },
      });
    }
    return fn(this.contextFor(parent, hooks));
  }

  private contextFor(
    tx: Prisma.TransactionClient,
    hooks: HookRegistry,
  ): TransactionContext {
    return {
      tx,
      emit: async (aggregateType, aggregateId, eventType, payload) => {
        await this.outbox.appendEvent(
          tx,
          aggregateType,
          aggregateId,
          eventType,
          payload,
          { wakeRelay: false },
        );
        if (!hooks.commit.includes(this.wakeRelayHook)) {
          hooks.commit.push(this.wakeRelayHook);
        }
      },
      publish: async (input) => {
        await this.outbox.appendEnvelope(tx, input, { wakeRelay: false });
        if (!hooks.commit.includes(this.wakeRelayHook)) {
          hooks.commit.push(this.wakeRelayHook);
        }
      },
      audit: async (input) => {
        const event = buildAuditEvent({
          ...input,
          source: currentProcessRole(),
        });
        await this.outbox.appendEvent(
          tx,
          'audit',
          event.entityId ?? event.eventId,
          RABBITMQ_ROUTING_KEYS.AUDIT_EVENT,
          event as unknown as Record<string, unknown>,
          { wakeRelay: false },
        );
        if (!hooks.commit.includes(this.wakeRelayHook)) {
          hooks.commit.push(this.wakeRelayHook);
        }
      },
      startWorkflow: async (input) => {
        await this.outbox.appendEvent(
          tx,
          'workflow',
          input.workflowId,
          RABBITMQ_ROUTING_KEYS.WORKFLOW_START,
          input as unknown as Record<string, unknown>,
          { wakeRelay: false },
        );
        if (!hooks.commit.includes(this.wakeRelayHook)) {
          hooks.commit.push(this.wakeRelayHook);
        }
      },
      afterCommit: (hook) => {
        hooks.commit.push(hook);
      },
      afterRollback: (hook) => {
        hooks.rollback.push(hook);
      },
    };
  }

  private readonly wakeRelayHook: Hook = () => {
    this.outbox.wakeRelay();
  };

  private reportDuration(name: string, startedAt: number, attempts: number) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= SLOW_TRANSACTION_MS) {
      this.logger.warn(
        `Slow transaction "${name}": ${elapsed} ms over ${attempts} attempt(s)`,
      );
    }
  }
}
