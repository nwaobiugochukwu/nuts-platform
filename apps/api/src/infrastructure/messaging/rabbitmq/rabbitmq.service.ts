import {
  REQUEST_ID_HEADER,
  currentRequestId,
  runWithRequestId,
  sanitizeRequestId,
} from '@api/common/request-context/request-context.util';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import {
  OBSOLETE_BINDINGS,
  QUEUE_BINDINGS,
  RABBITMQ_EXCHANGES,
  RABBITMQ_QUEUES,
} from './rabbitmq.constants';
import {
  getErrorCode,
  getErrorMessage,
} from '@api/common/utils/error-details.util';
import {
  ATTEMPT_HEADER,
  CIRCUIT_WAITS_HEADER,
  DEFAULT_PREFETCH,
  HANDLER_TIMEOUT_MS,
  QUEUE_PREFETCH,
  decideFailure,
  retryDelaysFor,
  retryQueueName,
} from './consumer-retry.util';
import { recordConsumerOutcome } from './consumer-outcome.util';

type ConsumerHandler<T = unknown> = (
  payload: T,
  originalMessage: amqp.ConsumeMessage,
) => Promise<void>;

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.ConfirmChannel | null = null;
  private isConnecting = false;
  private isConnected = false;
  private isDestroyed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private initPromise: Promise<void> | null = null;

  private hasLoggedInitialWarning = false;
  private currentBackoffMs = 15000;

  /**
   * Registry of consumers to automatically bind upon connection or reconnection.
   */
  private readonly registeredConsumers = new Map<
    string,
    ConsumerHandler<unknown>[]
  >();

  /**
   * Handlers already consuming on the current channel. Cleared whenever a new channel is
   * created, so a handler is bound exactly once per channel even when it registers while the
   * connection is still being set up.
   */
  private boundHandlers = new Set<ConsumerHandler<unknown>>();
  /** Consumer tags on the current channel, so shutdown can stop taking new messages first. */
  private consumerTags: string[] = [];
  /** Messages being handled right now; shutdown waits for them to finish. */
  private inFlight = 0;
  private static readonly DRAIN_TIMEOUT_MS = 25_000;
  /** Binds run one at a time: prefetch applies to the consumer started right after it. */
  private bindChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.initPromise = this.connect();
    await this.initPromise;
  }

  async onModuleDestroy() {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.drainConsumers();
    await this.disconnect();
  }

  /**
   * Stops taking new messages, then waits (up to DRAIN_TIMEOUT_MS) for the ones being handled
   * to finish and be acknowledged. Without this, closing the channel makes the broker redeliver
   * every in-flight message on each deploy.
   */
  private async drainConsumers(): Promise<void> {
    const channel = this.channel;
    if (channel) {
      await Promise.all(
        this.consumerTags.map((tag) =>
          channel.cancel(tag).catch(() => undefined),
        ),
      );
    }
    this.consumerTags = [];
    const deadline = Date.now() + RabbitMQService.DRAIN_TIMEOUT_MS;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.inFlight > 0) {
      this.logger.warn(
        `Shutting down with ${this.inFlight} message(s) still being handled; the broker will redeliver them.`,
      );
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isDestroyed) return;
    const delay = this.currentBackoffMs;
    // Exponential backoff up to 2 minutes
    this.currentBackoffMs = Math.min(
      Math.round(this.currentBackoffMs * 1.5),
      120000,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isConnected && !this.isDestroyed) {
        void this.connect();
      }
    }, delay);
    this.reconnectTimer.unref();
  }

  private async connect(): Promise<void> {
    if (this.isConnecting || this.isDestroyed) return;
    this.isConnecting = true;

    const enabled =
      this.config.get<string>('RABBITMQ_ENABLED', 'true') !== 'false';
    if (!enabled) {
      if (!this.hasLoggedInitialWarning) {
        this.logger.log(
          'RabbitMQ is disabled (RABBITMQ_ENABLED=false). Outbox events will remain pending until RabbitMQ is enabled.',
        );
        this.hasLoggedInitialWarning = true;
      }
      this.isConnecting = false;
      return;
    }

    const url =
      this.config.get<string>('RABBITMQ_URL') ||
      'amqp://nuts:nuts_local_dev@localhost:5672';
    const brokerAddress = this.describeBrokerAddress(url);

    try {
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createConfirmChannel();
      this.boundHandlers = new Set();
      this.consumerTags = [];

      this.connection.on('error', (err) => {
        this.logger.error(
          { code: (err as NodeJS.ErrnoException).code },
          'RabbitMQ connection error',
        );
        this.isConnected = false;
        this.channel = null;
        this.scheduleReconnect();
      });

      this.connection.on('close', () => {
        if (!this.isDestroyed) {
          this.logger.warn(
            'RabbitMQ connection closed. Attempting reconnect...',
          );
          this.isConnected = false;
          this.channel = null;
          this.scheduleReconnect();
        }
      });

      // Assert Exchange Topologies
      await this.channel.assertExchange(RABBITMQ_EXCHANGES.DLX, 'direct', {
        durable: true,
      });

      await this.channel.assertExchange(RABBITMQ_EXCHANGES.TOPIC, 'topic', {
        durable: true,
      });

      // Assert Dead Letter Queue
      await this.channel.assertQueue(RABBITMQ_QUEUES.DLQ, { durable: true });
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.DLQ,
        RABBITMQ_EXCHANGES.DLX,
        'dlq',
      );

      // Assert Work Queues with DLX bindings
      const queueOptions = {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': RABBITMQ_EXCHANGES.DLX,
          'x-dead-letter-routing-key': 'dlq',
        },
      };

      for (const [queue, keys] of Object.entries(QUEUE_BINDINGS)) {
        await this.channel.assertQueue(queue, queueOptions);
        for (const key of keys) {
          await this.channel.bindQueue(queue, RABBITMQ_EXCHANGES.TOPIC, key);
        }
      }
      for (const { queue, key } of OBSOLETE_BINDINGS) {
        await this.channel.unbindQueue(queue, RABBITMQ_EXCHANGES.TOPIC, key);
      }

      // Retry queues: a failed message waits in one (no consumer, expires after its delay) and
      // is dead-lettered back to its work queue through the default exchange.
      for (const queue of Object.values(RABBITMQ_QUEUES)) {
        if (queue === RABBITMQ_QUEUES.DLQ) continue;
        for (const delayMs of retryDelaysFor()) {
          await this.channel.assertQueue(retryQueueName(queue, delayMs), {
            durable: true,
            arguments: {
              'x-message-ttl': delayMs,
              'x-dead-letter-exchange': '',
              'x-dead-letter-routing-key': queue,
            },
          });
        }
      }

      this.isConnected = true;
      this.hasLoggedInitialWarning = false;
      this.currentBackoffMs = 15000;
      this.logger.log('RabbitMQ fabric successfully connected and configured.');

      // Bind all registered consumers upon successful connection/reconnection
      let boundCount = 0;
      for (const [queue, handlers] of this.registeredConsumers.entries()) {
        for (const handler of handlers) {
          if (await this.bindConsumer(queue, handler)) boundCount++;
        }
      }

      if (boundCount > 0) {
        this.logger.log(
          `Successfully bound ${boundCount} RabbitMQ consumer(s).`,
        );
      }
    } catch (err: unknown) {
      if (!this.hasLoggedInitialWarning) {
        this.logger.warn(
          `RabbitMQ broker not reachable at ${brokerAddress}: ${getErrorMessage(err)}. Outbox events will remain pending until the broker reconnects. Configure RABBITMQ_URL if using a remote or custom broker.`,
        );
        this.hasLoggedInitialWarning = true;
      } else {
        this.logger.debug(
          `RabbitMQ background reconnect attempt to ${brokerAddress} failed: ${getErrorMessage(err)}. Next retry in ${Math.round(this.currentBackoffMs / 1000)}s.`,
        );
      }
      this.isConnected = false;
      this.channel = null;
      this.scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  private describeBrokerAddress(url: string): string {
    try {
      const parsed = new URL(url);
      const port = parsed.port ? `:${parsed.port}` : '';
      return `${parsed.protocol}//${parsed.hostname}${port}`;
    } catch {
      return 'configured endpoint';
    }
  }

  private async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch {
      // Ignore on shutdown
    } finally {
      this.isConnected = false;
      this.channel = null;
      this.connection = null;
    }
  }

  /** Adds the current request id (if any) to a message's headers. */
  private withRequestId(
    headers: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    const requestId = currentRequestId();
    if (!requestId || headers?.[REQUEST_ID_HEADER]) return headers;
    return { ...headers, [REQUEST_ID_HEADER]: requestId };
  }

  public publish<T>(
    routingKey: string,
    message: T,
    options?: amqp.Options.Publish,
  ): Promise<boolean> {
    const channel = this.channel;
    if (!channel || !this.isConnected) {
      this.logger.debug(
        `RabbitMQ channel offline. Skipping live publish to [${routingKey}]. Transactional Outbox will handle delivery.`,
      );
      return Promise.resolve(false);
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(JSON.stringify(message));
    } catch (err: unknown) {
      this.logger.error(
        { routingKey, code: getErrorCode(err) },
        'Failed to serialize RabbitMQ message',
      );
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      try {
        const writable = channel.publish(
          RABBITMQ_EXCHANGES.TOPIC,
          routingKey,
          buffer,
          {
            persistent: true,
            contentType: 'application/json',
            timestamp: Date.now(),
            ...options,
            headers: this.withRequestId(
              options?.headers as Record<string, unknown> | undefined,
            ),
          },
          (err) => {
            if (err) {
              this.logger.error(
                { routingKey, code: getErrorCode(err) },
                'RabbitMQ rejected published message',
              );
              resolve(false);
              return;
            }
            resolve(true);
          },
        );
        if (!writable) {
          this.logger.debug(
            { routingKey },
            'RabbitMQ publisher buffer is full; waiting for broker confirmation',
          );
        }
      } catch (err: unknown) {
        this.logger.error(
          { routingKey, code: getErrorCode(err) },
          'Failed to publish to RabbitMQ channel',
        );
        resolve(false);
      }
    });
  }

  /**
   * Returns whether RabbitMQ channel is actively connected and ready for traffic
   */
  public isAvailable(): boolean {
    return this.isConnected && this.channel !== null;
  }

  /**
   * Message and consumer counts for every queue we declare, for monitoring.
   * Returns an empty list when the broker is unavailable. Queues are asserted at
   * connect time, so `checkQueue` cannot hit a missing queue (which would close
   * the channel).
   */
  public async getQueueStats(): Promise<
    Array<{ queue: string; messages: number; consumers: number }>
  > {
    if (!this.isAvailable() || !this.channel) return [];
    const stats: Array<{ queue: string; messages: number; consumers: number }> =
      [];
    for (const queue of Object.values(RABBITMQ_QUEUES)) {
      try {
        const info = await this.channel.checkQueue(queue);
        stats.push({
          queue,
          messages: info.messageCount,
          consumers: info.consumerCount,
        });
      } catch (error) {
        this.logger.warn(
          `Could not read stats for queue ${queue}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        break;
      }
    }
    return stats;
  }

  /**
   * Age in seconds of the oldest message in the dead-letter queue (0 when it is empty), read by
   * looking at the head message and putting it straight back. Returns null if the broker is
   * unavailable. The publish time travels with the message through dead-lettering.
   */
  public async getDeadLetterOldestAgeSeconds(): Promise<number | null> {
    if (!this.isAvailable() || !this.channel) return null;
    try {
      const head = await this.channel.get(RABBITMQ_QUEUES.DLQ, {
        noAck: false,
      });
      if (!head) return 0;
      this.channel.nack(head, false, true);
      const published = Number(head.properties.timestamp);
      return Number.isFinite(published) && published > 0
        ? Math.max(0, (Date.now() - published) / 1000)
        : 0;
    } catch {
      return null;
    }
  }

  /**
   * Registers a consumer for a specific queue. If RabbitMQ is connected,
   * binds immediately; otherwise registers to auto-bind as soon as connection is established.
   */
  public async consume<T>(
    queue: string,
    handler: (
      payload: T,
      originalMessage: amqp.ConsumeMessage,
    ) => Promise<void>,
  ): Promise<void> {
    // Add to registered list
    const existing = this.registeredConsumers.get(queue) || [];
    const registeredHandler: ConsumerHandler<unknown> = (payload, message) =>
      handler(payload as T, message);
    existing.push(registeredHandler);
    this.registeredConsumers.set(queue, existing);

    // If connection handshake is currently in flight during startup, await it
    if (this.initPromise && this.isConnecting) {
      try {
        await this.initPromise;
      } catch {
        // connection error already caught and handled in connect()
      }
    }

    if (this.channel && this.isConnected) {
      await this.bindConsumer(queue, registeredHandler);
    } else {
      this.logger.debug(
        `Consumer registered for ${queue} (pending RabbitMQ broker connection).`,
      );
    }
  }

  private bindConsumer<T>(
    queue: string,
    handler: (
      payload: T,
      originalMessage: amqp.ConsumeMessage,
    ) => Promise<void>,
  ): Promise<boolean> {
    const bound = this.bindChain.then(() =>
      this.bindConsumerNow(queue, handler),
    );
    this.bindChain = bound.catch(() => undefined);
    return bound;
  }

  private async bindConsumerNow<T>(
    queue: string,
    handler: (
      payload: T,
      originalMessage: amqp.ConsumeMessage,
    ) => Promise<void>,
  ): Promise<boolean> {
    const channel = this.channel;
    if (!channel || !this.isConnected) return false;
    const key = handler as ConsumerHandler<unknown>;
    if (this.boundHandlers.has(key)) return false;
    this.boundHandlers.add(key);

    try {
      // Prefetch applies to the consumers started after this call, so each queue gets its own.
      await channel.prefetch(QUEUE_PREFETCH[queue] ?? DEFAULT_PREFETCH);
      const { consumerTag } = await channel.consume(
        queue,
        (msg) => {
          if (!msg) return;
          void this.handleDelivery(queue, key, msg);
        },
        { noAck: false },
      );
      this.consumerTags.push(consumerTag);
      return true;
    } catch (err: unknown) {
      this.boundHandlers.delete(key);
      this.logger.error(
        { queue, code: getErrorCode(err) },
        'Failed to bind RabbitMQ consumer',
      );
      return false;
    }
  }

  /** Runs one delivery through its handler and settles it: ack, retry later, or dead-letter. */
  private async handleDelivery(
    queue: string,
    handler: ConsumerHandler<unknown>,
    msg: amqp.ConsumeMessage,
  ): Promise<void> {
    const channel = this.channel;
    this.inFlight += 1;
    const startedAt = Date.now();
    try {
      const content: unknown = JSON.parse(msg.content.toString());
      // Restore the originating request id so logs, audit events and
      // anything this handler publishes next stay on the same trail.
      const requestId = sanitizeRequestId(
        msg.properties.headers?.[REQUEST_ID_HEADER],
      );
      const run = () => handler(content, msg);
      await this.withTimeout(
        requestId ? runWithRequestId(requestId, run) : run(),
        queue,
      );
      channel?.ack(msg);
      recordConsumerOutcome(queue, 'ok', (Date.now() - startedAt) / 1000);
    } catch (err: unknown) {
      await this.settleFailure(queue, msg, err, channel);
    } finally {
      this.inFlight -= 1;
    }
  }

  private withTimeout<T>(work: Promise<T>, queue: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Handler for ${queue} did not finish within ${HANDLER_TIMEOUT_MS} ms`,
            ),
          ),
        HANDLER_TIMEOUT_MS,
      );
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  private async settleFailure(
    queue: string,
    msg: amqp.ConsumeMessage,
    err: unknown,
    channel: amqp.ConfirmChannel | null,
  ): Promise<void> {
    const headers = msg.properties.headers ?? {};
    const attempt = Number(headers[ATTEMPT_HEADER] ?? 0) || 0;
    const circuitWaits = Number(headers[CIRCUIT_WAITS_HEADER] ?? 0) || 0;
    const decision = decideFailure(err, attempt, circuitWaits);
    const logContext = {
      queue,
      attempt,
      errorName: err instanceof Error ? err.name : 'UnknownError',
    };

    if (decision.action === 'dead') {
      this.logger.error(
        { ...logContext, reason: decision.reason },
        'Error processing RabbitMQ message; dead-lettering it',
      );
      // Routes to the dead-letter queue through the work queue's DLX arguments.
      channel?.nack(msg, false, false);
      recordConsumerOutcome(queue, 'dead-lettered');
      return;
    }

    const retried = await this.publishToRetryQueue(
      queue,
      msg,
      decision.delayMs,
      decision.attempt,
      decision.circuitWaits,
    );
    if (retried) {
      this.logger.warn(
        { ...logContext, retryInMs: decision.delayMs },
        'Error processing RabbitMQ message; will retry',
      );
      channel?.ack(msg);
      recordConsumerOutcome(
        queue,
        decision.circuitWaits > circuitWaits ? 'circuit-wait' : 'retried',
      );
    } else {
      // The retry queue could not take it (broker trouble): keep the message where it is.
      this.logger.error(
        logContext,
        'Error processing RabbitMQ message and could not schedule a retry; requeueing it',
      );
      channel?.nack(msg, false, true);
    }
  }

  private publishToRetryQueue(
    queue: string,
    msg: amqp.ConsumeMessage,
    delayMs: number,
    attempt: number,
    circuitWaits: number,
  ): Promise<boolean> {
    const channel = this.channel;
    if (!channel || !this.isConnected) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      try {
        channel.sendToQueue(
          retryQueueName(queue, delayMs),
          msg.content,
          {
            persistent: true,
            contentType: msg.properties.contentType as string | undefined,
            messageId: msg.properties.messageId as string | undefined,
            timestamp: msg.properties.timestamp as number | undefined,
            headers: {
              ...Object.fromEntries(
                Object.entries(msg.properties.headers ?? {}).filter(
                  ([name]) => name !== 'x-death',
                ),
              ),
              [ATTEMPT_HEADER]: attempt,
              [CIRCUIT_WAITS_HEADER]: circuitWaits,
            },
          },
          (err) => resolve(!err),
        );
      } catch {
        resolve(false);
      }
    });
  }
}
