import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import {
  RABBITMQ_EXCHANGES,
  RABBITMQ_QUEUES,
  RABBITMQ_ROUTING_KEYS,
} from './rabbitmq.constants';
import {
  getErrorCode,
  getErrorMessage,
} from '@api/common/utils/error-details.util';

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
    await this.disconnect();
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

      await this.channel.assertQueue(RABBITMQ_QUEUES.EMAILS, queueOptions);
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.EMAILS,
        RABBITMQ_EXCHANGES.TOPIC,
        RABBITMQ_QUEUES.EMAILS,
      );
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.EMAILS,
        RABBITMQ_EXCHANGES.TOPIC,
        'email.*',
      );
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.EMAILS,
        RABBITMQ_EXCHANGES.TOPIC,
        'order.*',
      );

      await this.channel.assertQueue(
        RABBITMQ_QUEUES.NOTIFICATIONS,
        queueOptions,
      );
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.NOTIFICATIONS,
        RABBITMQ_EXCHANGES.TOPIC,
        RABBITMQ_QUEUES.NOTIFICATIONS,
      );
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.NOTIFICATIONS,
        RABBITMQ_EXCHANGES.TOPIC,
        'notification.*',
      );
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.NOTIFICATIONS,
        RABBITMQ_EXCHANGES.TOPIC,
        'order.*',
      );
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.NOTIFICATIONS,
        RABBITMQ_EXCHANGES.TOPIC,
        'payment.*',
      );

      await this.channel.assertQueue(RABBITMQ_QUEUES.ANALYTICS, queueOptions);
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.ANALYTICS,
        RABBITMQ_EXCHANGES.TOPIC,
        RABBITMQ_ROUTING_KEYS.ANALYTICS_EVENT,
      );

      await this.channel.assertQueue(
        RABBITMQ_QUEUES.VENDOR_EVENTS,
        queueOptions,
      );
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.VENDOR_EVENTS,
        RABBITMQ_EXCHANGES.TOPIC,
        RABBITMQ_ROUTING_KEYS.VENDOR_FOLLOWED,
      );
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.VENDOR_EVENTS,
        RABBITMQ_EXCHANGES.TOPIC,
        RABBITMQ_ROUTING_KEYS.VENDOR_UNFOLLOWED,
      );

      await this.channel.assertQueue(RABBITMQ_QUEUES.INVENTORY, queueOptions);
      await this.channel.bindQueue(
        RABBITMQ_QUEUES.INVENTORY,
        RABBITMQ_EXCHANGES.TOPIC,
        'inventory.*',
      );

      // Quality of Service: Prefetch 10 messages per consumer
      await this.channel.prefetch(10);

      this.isConnected = true;
      this.hasLoggedInitialWarning = false;
      this.currentBackoffMs = 15000;
      this.logger.log('RabbitMQ fabric successfully connected and configured.');

      // Bind all registered consumers upon successful connection/reconnection
      let boundCount = 0;
      for (const [queue, handlers] of this.registeredConsumers.entries()) {
        for (const handler of handlers) {
          await this.bindConsumer(queue, handler);
          boundCount++;
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

  private async bindConsumer<T>(
    queue: string,
    handler: (
      payload: T,
      originalMessage: amqp.ConsumeMessage,
    ) => Promise<void>,
  ): Promise<void> {
    if (!this.channel || !this.isConnected) return;

    try {
      await this.channel.consume(
        queue,
        (msg) => {
          if (!msg) return;

          void (async () => {
            try {
              const content: unknown = JSON.parse(msg.content.toString());
              await handler(content as T, msg);
              this.channel?.ack(msg);
            } catch (err: unknown) {
              this.logger.error(
                {
                  queue,
                  errorName: err instanceof Error ? err.name : 'UnknownError',
                },
                'Error processing RabbitMQ message',
              );
              // Failed messages go to the dead letter queue for inspection.
              this.channel?.nack(msg, false, false);
            }
          })();
        },
        { noAck: false },
      );
    } catch (err: unknown) {
      this.logger.error(
        { queue, code: getErrorCode(err) },
        'Failed to bind RabbitMQ consumer',
      );
    }
  }
}
