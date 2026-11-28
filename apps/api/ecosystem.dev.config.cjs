/**
 * PM2 process description for LOCAL DEVELOPMENT (`npm run dev`).
 *
 * The same supervisor and the same program names as staging
 * (ecosystem.config.cjs), so development behaves the same way: each program is
 * its own process, a crashed program is restarted automatically, and logs are
 * prefixed with the program name.
 *
 *   tsc     TypeScript compiler in watch mode (writes dist/)
 *   api     HTTP requests, login, checkout, live notifications
 *   worker  queue consumers + outbox relay
 *   jobs    scheduled jobs
 *   all     everything in one process (debugging only, not how staging runs)
 *   debug   like `all`, with the Node inspector on port 9229
 *
 * The programs restart when the compiler rewrites dist/ (debounced). Ports come
 * from the env file or the defaults in `portFor`; see apps/api/.env.example.
 */
const common = {
  cwd: __dirname,
  node_args: '-r tsconfig-paths/register',
  // Restart a crashed program with a growing delay instead of giving up, so a
  // syntax error mid-edit recovers by itself once it is fixed.
  autorestart: true,
  exp_backoff_restart_delay: 500,
  max_restarts: 50,
  min_uptime: '10s',
  kill_timeout: 5000,
  merge_logs: true,
  time: false,
  watch: ['dist'],
  ignore_watch: ['node_modules', '\\.map$', '\\.d\\.ts$', '\\.tsbuildinfo$'],
  watch_delay: 1000,
  env: {
    NODE_ENV: 'development',
    TS_NODE_PROJECT: 'tsconfig.runtime.json',
  },
};

module.exports = {
  apps: [
    {
      name: 'tsc',
      cwd: __dirname,
      script: '../../node_modules/@typescript/native/lib/tsc.js',
      args: '-p tsconfig.build.json --watch --preserveWatchOutput',
      autorestart: true,
      watch: false,
      merge_logs: true,
      time: false,
    },
    {
      ...common,
      name: 'api',
      script: 'dist/main.js',
      env: { ...common.env, PROCESS_ROLE: 'api' },
    },
    {
      ...common,
      name: 'worker',
      script: 'dist/bootstrap/worker.js',
      env: { ...common.env, PROCESS_ROLE: 'worker' },
    },
    {
      ...common,
      name: 'jobs',
      script: 'dist/bootstrap/worker.js',
      env: { ...common.env, PROCESS_ROLE: 'jobs' },
    },
    {
      ...common,
      name: 'all',
      script: 'dist/main.js',
      env: { ...common.env, PROCESS_ROLE: 'all' },
    },
    {
      ...common,
      name: 'debug',
      script: 'dist/main.js',
      node_args: '--inspect=9229 -r tsconfig-paths/register',
      env: { ...common.env, PROCESS_ROLE: 'all' },
    },
  ],
};
