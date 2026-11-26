import 'reflect-metadata';
import './instrument';

import { NestFactory } from '@nestjs/core';
import { createServer } from 'node:http';
import { Logger } from 'nestjs-pino';
import {
  NativeConnection,
  Runtime,
  Worker,
  bundleWorkflowCode,
} from '@temporalio/worker';
import { portFor } from './infrastructure/configuration/process-role';
import { buildActivities } from './infrastructure/temporal/activities';
import { SampleActivities } from './infrastructure/temporal/activities/sample.activities';
import {
  queuesToPoll,
  readTemporalConfig,
} from './infrastructure/temporal/temporal.config';
import { TemporalWorkerModule } from './infrastructure/temporal/temporal-worker.module';

/**
 * Entry point for the `temporal-worker` role: runs Temporal workflows and
 * activities. It needs a glibc base image (the Temporal native core has no
 * musl build), so it ships as its own image target; see docs/operations.
 */
async function bootstrap() {
  process.env.LOG_PROGRAM = 'temporal-worker';
  const config = readTemporalConfig();
  if (!config.enabled) {
    throw new Error('Set TEMPORAL_ENABLED=true to run the Temporal worker.');
  }

  // The Temporal SDK exposes its own Prometheus endpoint; TEMPORAL_METRICS_PORT
  // keeps its established name and overrides the per-program default.
  const metricsPort =
    Number(process.env.TEMPORAL_METRICS_PORT) ||
    portFor('metrics', 'temporal-worker');
  if (metricsPort && Number.isInteger(metricsPort) && metricsPort > 0) {
    Runtime.install({
      telemetryOptions: {
        metrics: { prometheus: { bindAddress: `0.0.0.0:${metricsPort}` } },
      },
    });
  }

  const app = await NestFactory.createApplicationContext(TemporalWorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);

  const connection = await NativeConnection.connect({
    address: config.address,
    tls: config.tls ? {} : undefined,
    apiKey: config.apiKey,
  });

  // Bundle workflow code once and share it between the task-queue workers.
  const workflowBundle = await bundleWorkflowCode({
    workflowsPath: require.resolve('./infrastructure/temporal/workflows'),
  });
  const activities = buildActivities(app.get(SampleActivities));

  const queues = queuesToPoll();
  const workers = await Promise.all(
    queues.map((taskQueue) =>
      Worker.create({
        connection,
        namespace: config.namespace,
        taskQueue,
        workflowBundle,
        activities,
      }),
    ),
  );

  const running = Promise.all(workers.map((worker) => worker.run()));
  const startedAt = new Date();
  const healthPort = portFor('health', 'temporal-worker') ?? 3004;
  const server = createServer((req, res) => {
    if (req.url !== '/health' && req.url !== '/') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        role: 'temporal-worker',
        namespace: config.namespace,
        taskQueues: queues,
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
      }),
    );
  });
  server.listen(healthPort, '0.0.0.0');

  // Stop polling, let in-flight activities finish, then exit.
  const shutdown = () => {
    server.close();
    for (const worker of workers) worker.shutdown();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  logger.log(
    `Temporal worker polling ${queues.join(', ')} in namespace ${config.namespace} (health on :${healthPort}).`,
  );
  process.send?.('ready');

  await running;
  await connection.close();
  await app.close();
}

bootstrap().catch((error) => {
  console.error('Failed to start Temporal worker', error);
  process.exit(1);
});
