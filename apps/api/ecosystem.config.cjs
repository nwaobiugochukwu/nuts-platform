/**
 * PM2 process description for the NUTS API image.
 *
 * One image, several independent roles. Each container starts exactly one of
 * them (`pm2-runtime ecosystem.config.cjs --only <app>`), so a crash in one
 * role never takes down the others; PM2 restarts the process with backoff
 * before the container itself is considered unhealthy.
 *
 *   all     everything in one process (PROCESS_ROLE=all): the DEFAULT when PM2_APP is unset,
 *           and the one-service fallback for hosts that run a single container
 *   api     HTTP + SSE (PROCESS_ROLE=api)
 *   worker  RabbitMQ consumers + outbox relay (PROCESS_ROLE=worker)
 *   jobs    scheduled jobs, exactly one instance (PROCESS_ROLE=jobs)
 *   temporal-worker  Temporal workflows and activities (glibc image only)
 *
 * Tunables (all optional):
 *   PM2_API_INSTANCES   api instances; >1 switches api to cluster mode (needs spare CPUs)
 *   PM2_MAX_MEMORY      restart a process gracefully above this RSS (default 600M)
 *   PM2_KILL_TIMEOUT_MS time allowed to drain on stop/reload (default 30000)
 */
const instances = Math.max(1, Number(process.env.PM2_API_INSTANCES || 1));
const maxMemory = process.env.PM2_MAX_MEMORY || '600M';
const killTimeout = Number(process.env.PM2_KILL_TIMEOUT_MS || 30000);

const common = {
  cwd: __dirname,
  node_args: '-r tsconfig-paths/register',
  // Crash-loop protection: a process that dies within min_uptime counts as a
  // failed start; after max_restarts failures PM2 stops retrying and the
  // container healthcheck takes over.
  min_uptime: '20s',
  max_restarts: 10,
  exp_backoff_restart_delay: 200,
  max_memory_restart: maxMemory,
  kill_timeout: killTimeout,
  // The app signals readiness with process.send('ready') once it is serving.
  wait_ready: true,
  listen_timeout: 60000,
  // Logs stay structured JSON on stdout/stderr; the container log driver ships them.
  merge_logs: true,
  time: false,
  autorestart: true,
  env: {
    NODE_ENV: process.env.NODE_ENV || 'production',
    TS_NODE_PROJECT: './tsconfig.runtime.json',
  },
};

module.exports = {
  apps: [
    {
      // Everything in one process, as before the split. The default, so a
      // service nobody has configured keeps working exactly as it did.
      ...common,
      name: 'all',
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      env: { ...common.env, PROCESS_ROLE: 'all' },
    },
    {
      ...common,
      name: 'api',
      script: 'dist/main.js',
      exec_mode: instances > 1 ? 'cluster' : 'fork',
      instances,
      env: { ...common.env, PROCESS_ROLE: 'api' },
    },
    {
      ...common,
      name: 'worker',
      script: 'dist/bootstrap/worker.js',
      exec_mode: 'fork',
      instances: 1,
      env: { ...common.env, PROCESS_ROLE: 'worker' },
    },
    {
      // Temporal workflows and activities. Needs a glibc image (see Dockerfile
      // target runner-temporal); do not start it from the Alpine image.
      ...common,
      name: 'temporal-worker',
      script: 'dist/bootstrap/temporal-worker.js',
      exec_mode: 'fork',
      instances: 1,
      env: { ...common.env },
    },
    {
      ...common,
      name: 'jobs',
      script: 'dist/bootstrap/worker.js',
      exec_mode: 'fork',
      instances: 1,
      env: { ...common.env, PROCESS_ROLE: 'jobs' },
    },
  ],
};
