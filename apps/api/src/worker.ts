import 'reflect-metadata';
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createServer } from 'node:http';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { currentProcessRole } from './infrastructure/configuration/process-role';
import {
  buildWorkerHealth,
  stopCronsUnlessJobsRole,
} from './infrastructure/configuration/role-runtime';
import { RabbitMQService } from './infrastructure/rabbitmq/rabbitmq.service';
import { MetricsService } from './infrastructure/metrics/metrics.service';
import { startMetricsServer } from './infrastructure/metrics/metrics-server';

/**
 * Entry point for the `worker` (queue consumers + outbox relay) and `jobs`
 * (scheduled jobs) roles. No HTTP application is created; a tiny health
 * server reports liveness for the container healthcheck and PM2.
 */
async function bootstrap() {
  const role = currentProcessRole();
  if (role === 'api') {
    throw new Error('worker.ts cannot run the api role; use main.ts');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);
  const config = app.get(ConfigService);

  const stopped = stopCronsUnlessJobsRole(app);
  if (stopped > 0)
    logger.log(`Role "${role}": stopped ${stopped} cron job(s).`);

  const startedAt = new Date();
  const brokerRequired =
    config.get<string>('RABBITMQ_ENABLED', 'true') !== 'false';
  const rabbit = app.get(RabbitMQService, { strict: false });
  const healthPort = Number(config.get('HEALTH_PORT') ?? 3002);

  const server = createServer((req, res) => {
    if (req.url !== '/health' && req.url !== '/') {
      res.writeHead(404).end();
      return;
    }
    const health = buildWorkerHealth({
      role,
      uptimeSeconds: Math.round(process.uptime()),
      brokerRequired: brokerRequired && role !== 'jobs',
      brokerAvailable: rabbit?.isAvailable() ?? false,
      startedAt,
    });
    res.writeHead(health.status === 'ok' ? 200 : 503, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify(health));
  });
  server.listen(healthPort, '0.0.0.0');
  const metricsServer = startMetricsServer(app.get(MetricsService));

  app.enableShutdownHooks();
  const shutdown = () => {
    server.close();
    metricsServer?.close();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  logger.log(`Role "${role}" started (health on :${healthPort}).`);
  // Tells PM2 (wait_ready) that this process is up.
  process.send?.('ready');
}

bootstrap().catch((error) => {
  console.error('Failed to start worker', error);
  process.exit(1);
});
