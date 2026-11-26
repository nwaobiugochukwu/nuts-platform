#!/usr/bin/env node
// `npm run dev`: starts everything in strict order, each step waiting for the previous to be healthy.
//   node scripts/dev.mjs [--skip-infra] [--timeout <seconds>] [--quiet]
// Full output of every service is always written to .logs/dev/<service>.log.
// With --quiet the terminal shows only start/ready/failed lines (follow one with: tail -f .logs/dev/api.log).
import { runSequence } from './dev-orchestrator.mjs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const skipInfra = args.includes('--skip-infra');
const quiet = args.includes('--quiet');
const t = args.indexOf('--timeout');
const timeoutMs = (t >= 0 ? Number(args[t + 1]) : 120) * 1000;
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('Usage: node scripts/dev.mjs [--skip-infra] [--timeout <seconds>] [--quiet]');
  process.exit(2);
}

// Same override rules as the programs: {PROGRAM}_HEALTH_PORT, then defaults.
const env = process.env;
const port = (name, fallback) => Number(env[name]) || fallback;
const apiPort = port('PORT', 3001);
const workerPort = port('WORKER_HEALTH_PORT', 3002);
const jobsPort = port('JOBS_HEALTH_PORT', 3003);
const webPort = 5173;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const steps = [];
if (!skipInfra) {
  steps.push({ name: 'data', color: 'yellow', command: npm, args: ['run', 'db:up'], ready: { exit: true }, timeoutMs });
}
steps.push(
  { name: 'compile', color: 'blue', command: npm, args: ['run', 'dev:compile'], ready: { log: /Found \d+ errors?\. Watching for file changes/ }, timeoutMs },
  { name: 'api', color: 'green', command: npm, args: ['run', 'dev:api'], ready: { http: `http://localhost:${apiPort}/api/v1/health` }, timeoutMs },
  { name: 'worker', color: 'magenta', command: npm, args: ['run', 'dev:worker'], env: { WORKER_HEALTH_PORT: String(workerPort) }, ready: { http: `http://localhost:${workerPort}/health` }, timeoutMs },
  { name: 'jobs', color: 'cyan', command: npm, args: ['run', 'dev:jobs'], env: { JOBS_HEALTH_PORT: String(jobsPort) }, ready: { http: `http://localhost:${jobsPort}/health` }, timeoutMs },
  { name: 'web', color: 'red', command: npm, args: ['run', 'dev:web'], ready: { log: /Ready in|Local:\s+http/ }, timeoutMs },
);

const ac = new AbortController();
let seq;
const shutdown = async () => {
  console.log('\nStopping all services...');
  ac.abort();
  if (seq) await seq.stop();
  if (!skipInfra) console.log('(Data services keep running; stop them with: npm run db:down)');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

seq = await runSequence(steps, { color: process.stdout.isTTY, signal: ac.signal, defaultTimeoutMs: timeoutMs, logDir: '.logs/dev', quiet });
if (seq.results.every((r) => r.status === 'ready')) console.log('\nAll services are up. Press Ctrl+C to stop them.');
else console.log('\nSome services are not ready (see above). The others keep running. Press Ctrl+C to stop.');
// The data step exits on its own; keep this process alive while the others run.
setInterval(() => {}, 1 << 30);
