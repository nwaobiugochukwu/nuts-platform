import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RABBITMQ_QUEUES } from '../rabbitmq/rabbitmq.constants';
import { roleCan } from '../configuration/process-role';
import {
  TemporalClientService,
  type StartWorkflowInput,
} from './temporal-client.service';

/**
 * Starts workflows from outbox events (`ctx.startWorkflow` inside a
 * transaction). The workflow id is the business key, so a redelivered message
 * cannot start a second run.
 */
@Injectable()
export class WorkflowStartConsumer implements OnModuleInit {
  private readonly logger = new Logger(WorkflowStartConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly temporal: TemporalClientService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers') || !this.temporal.enabled) return;
    await this.rabbitmq.consume<StartWorkflowInput>(
      RABBITMQ_QUEUES.WORKFLOWS,
      async (message) => {
        if (
          !message?.workflowType ||
          !message.workflowId ||
          !message.taskQueue
        ) {
          this.logger.warn('Skipping malformed workflow-start message');
          return;
        }
        const result = await this.temporal.startWorkflow(message);
        if (!result.started && result.reason === 'already_started') {
          this.logger.debug(
            `Workflow ${message.workflowId} already started; ignoring duplicate.`,
          );
        }
      },
    );
  }
}
