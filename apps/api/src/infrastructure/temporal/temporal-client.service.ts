import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
} from '@temporalio/client';
import { readTemporalConfig, type TemporalConfig } from './temporal.config';

export interface StartWorkflowInput {
  /** The workflow function name exported from workflows/index.ts. */
  workflowType: string;
  /**
   * Business key, e.g. `order-payment:<orderId>`. Using the same id twice never
   * starts a second run, which makes every start idempotent.
   */
  workflowId: string;
  taskQueue: string;
  args?: unknown[];
}

export interface StartWorkflowResult {
  /** False when a run with this id already exists (a no-op) or Temporal is disabled. */
  started: boolean;
  workflowId: string;
  runId?: string;
  reason?: 'already_started' | 'disabled';
}

/**
 * Thin wrapper over the Temporal client: lazy connection, idempotent starts and
 * signal-with-start (so a signal that arrives before the workflow exists is not
 * lost, for example a payment webhook racing order creation).
 */
@Injectable()
export class TemporalClientService implements OnModuleDestroy {
  private readonly logger = new Logger(TemporalClientService.name);
  private readonly config: TemporalConfig = readTemporalConfig();
  private connection: Connection | null = null;
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  get enabled(): boolean {
    return this.config.enabled;
  }

  async startWorkflow(input: StartWorkflowInput): Promise<StartWorkflowResult> {
    if (!this.config.enabled) {
      this.logger.warn(
        `Temporal is disabled (TEMPORAL_ENABLED); not starting ${input.workflowType} ${input.workflowId}.`,
      );
      return {
        started: false,
        workflowId: input.workflowId,
        reason: 'disabled',
      };
    }
    const client = await this.getClient();
    try {
      const handle = await client.workflow.start(input.workflowType, {
        workflowId: input.workflowId,
        taskQueue: input.taskQueue,
        args: input.args ?? [],
      });
      return {
        started: true,
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
      };
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        return {
          started: false,
          workflowId: input.workflowId,
          reason: 'already_started',
        };
      }
      throw error;
    }
  }

  async signalWithStart(
    input: StartWorkflowInput & { signal: string; signalArgs?: unknown[] },
  ): Promise<void> {
    if (!this.config.enabled) {
      this.logger.warn(
        `Temporal is disabled; not signalling ${input.workflowType} ${input.workflowId}.`,
      );
      return;
    }
    const client = await this.getClient();
    await client.workflow.signalWithStart(input.workflowType, {
      workflowId: input.workflowId,
      taskQueue: input.taskQueue,
      args: input.args ?? [],
      signal: input.signal,
      signalArgs: input.signalArgs ?? [],
    });
  }

  async signal(
    workflowId: string,
    signalName: string,
    ...args: unknown[]
  ): Promise<void> {
    if (!this.config.enabled) return;
    const client = await this.getClient();
    await client.workflow.getHandle(workflowId).signal(signalName, ...args);
  }

  async describe(
    workflowId: string,
  ): Promise<{ status: string; runId: string }> {
    const client = await this.getClient();
    const description = await client.workflow.getHandle(workflowId).describe();
    return { status: description.status.name, runId: description.runId };
  }

  private getClient(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    this.connecting ??= this.connect().catch((error: unknown) => {
      // Allow a later call to retry instead of caching the failure.
      this.connecting = null;
      throw error;
    });
    return this.connecting;
  }

  private async connect(): Promise<Client> {
    this.connection = await Connection.connect({
      address: this.config.address,
      tls: this.config.tls ? {} : undefined,
      apiKey: this.config.apiKey,
    });
    this.client = new Client({
      connection: this.connection,
      namespace: this.config.namespace,
    });
    this.logger.log(
      `Connected to Temporal ${this.config.address} (namespace ${this.config.namespace}).`,
    );
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.close();
    this.connection = null;
    this.client = null;
    this.connecting = null;
  }
}
