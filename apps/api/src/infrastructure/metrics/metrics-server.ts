import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { currentProcessRole, portFor } from '../configuration/process-role';
import type { MetricsService } from './metrics.service';

/** Constant-time comparison so the token cannot be guessed byte by byte. */
export function tokenMatches(
  header: string | undefined,
  token: string,
): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Serves Prometheus metrics on a separate, internal port so they are never
 * reachable through the public reverse proxy. Disabled unless a metrics
 * port is configured (see `portFor`; on by default only in development). When METRICS_TOKEN is set, scrapes must send `Authorization: Bearer`.
 */
export function startMetricsServer(
  metrics: MetricsService,
  env: NodeJS.ProcessEnv = process.env,
): Server | null {
  const port = portFor('metrics', currentProcessRole(env), env);
  if (port === null) return null;
  const token = env.METRICS_TOKEN?.trim();

  const server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    if (token && !tokenMatches(req.headers.authorization, token)) {
      res.writeHead(401).end();
      return;
    }
    metrics
      .render()
      .then((body) => {
        res.writeHead(200, { 'Content-Type': metrics.contentType });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(500).end();
      });
  });
  server.listen(port, '0.0.0.0');
  return server;
}
