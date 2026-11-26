// Starts services one after another. Each step starts only when the previous one is ready.
// A step that never becomes ready is reported and the later steps still start (the services
// do not depend on each other once running). Ctrl+C stops every child, process groups included.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { waitHealthy } from './wait-healthy.mjs';

const COLORS = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m' };
const paint = (c, s, on) => (on ? `${COLORS[c] ?? ''}${s}${COLORS.reset}` : s);

/**
 * step = { name, color?, command, args?, cwd?, env?, ready, timeoutMs?, oneShot? }
 *   ready: { http: url } | { log: RegExp } | { exit: true } (one-shot command that must exit 0)
 * options = { out?, color?, spawnFn?, defaultTimeoutMs?, signal?, logDir?, quiet? }
 *   logDir: also write each service's full output to <logDir>/<name>.log
 *   quiet:  show only start/ready/failed lines and the summary (full output stays in the log files)
 * Returns { results: [{name, status: 'ready'|'failed', detail}], stop }.
 */
export async function runSequence(steps, options = {}) {
  const out = options.out ?? ((line) => process.stdout.write(line + '\n'));
  const color = options.color ?? false;
  const spawnFn = options.spawnFn ?? spawn;
  const defaultTimeout = options.defaultTimeoutMs ?? 120_000;
  const children = new Set();
  const results = [];
  let stopping = false;
  if (options.logDir) mkdirSync(options.logDir, { recursive: true });
  const width = Math.max(...steps.map((s) => s.name.length));

  const label = (step) => paint(step.color ?? 'gray', `[${step.name.padEnd(width)}]`, color);
  const say = (step, text) => out(`${label(step)} ${text}`);

  const kill = (child, signal) => {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* already gone */ }
  };

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    for (const c of children) kill(c, 'SIGTERM');
    const deadline = Date.now() + 5_000;
    while (children.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    for (const c of children) kill(c, 'SIGKILL');
  };
  options.signal?.addEventListener('abort', () => void stop());

  for (const step of steps) {
    if (stopping) break;
    say(step, paint('cyan', 'starting...', color));
    const timeoutMs = step.timeoutMs ?? defaultTimeout;
    let child;
    try {
      child = spawnFn(step.command, step.args ?? [], {
        cwd: step.cwd,
        env: { ...process.env, ...step.env, FORCE_COLOR: color ? '1' : '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      results.push({ name: step.name, status: 'failed', detail: `could not start: ${err.message}` });
      say(step, paint('red', `could not start: ${err.message}`, color));
      continue;
    }
    children.add(child);

    let exited = null; // { code }
    let logReady = false;
    const exitWaiters = [];
    child.on('exit', (code, sig) => {
      exited = { code, sig };
      children.delete(child);
      exitWaiters.forEach((f) => f());
    });
    child.on('error', (err) => {
      exited = { code: -1, err };
      children.delete(child);
      exitWaiters.forEach((f) => f());
    });
    const logFile = options.logDir ? createWriteStream(join(options.logDir, `${step.name}.log`), { flags: 'w' }) : null;
    child.on('close', () => logFile?.end());
    const onData = (buf) => {
      for (const line of String(buf).split(/\r?\n/)) {
        if (!line.trim()) continue;
        logFile?.write(line + '\n');
        if (!options.quiet) out(`${label(step)} ${line}`);
        if (step.ready.log && step.ready.log.test(line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))) logReady = true;
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    const outcome = await waitForReady(step, timeoutMs, () => logReady, () => exited, (f) => exitWaiters.push(f), options.signal);
    if (outcome.ok) {
      results.push({ name: step.name, status: 'ready', detail: outcome.detail ?? 'ready' });
      say(step, paint('green', `ready${outcome.detail ? ` (${outcome.detail})` : ''}`, color));
    } else {
      results.push({ name: step.name, status: 'failed', detail: outcome.reason });
      if (options.quiet && options.logDir) say(step, paint('gray', `see ${join(options.logDir, step.name + '.log')}`, color));
      say(step, paint('red', `NOT READY: ${outcome.reason}. Continuing with the next service.`, color));
    }
  }

  if (!stopping) {
    out('');
    out(paint('gray', '── Startup summary ──', color));
    for (const r of results) {
      const mark = r.status === 'ready' ? paint('green', 'OK    ', color) : paint('red', 'FAILED', color);
      out(`  ${mark} ${r.name.padEnd(width)}  ${r.detail}`);
    }
  }
  return { results, stop, children };
}

async function waitForReady(step, timeoutMs, isLogReady, getExit, onExit, signal) {
  const ready = step.ready;
  const deadline = Date.now() + timeoutMs;
  if (ready.http) {
    // Race the health poll against the process dying.
    const controller = new AbortController();
    signal?.addEventListener('abort', () => controller.abort());
    onExit(() => controller.abort());
    const r = await waitHealthy(ready.http, { timeoutMs, intervalMs: ready.intervalMs ?? 300, signal: controller.signal });
    if (r.ok) return { ok: true, detail: ready.http };
    const ex = getExit();
    if (ex) return { ok: false, reason: `process exited (code ${ex.code ?? ex.sig}) before ${ready.http} answered` };
    return { ok: false, reason: r.reason };
  }
  while (Date.now() < deadline) {
    if (signal?.aborted) return { ok: false, reason: 'cancelled' };
    const ex = getExit();
    if (ready.exit) {
      if (ex) return ex.code === 0 ? { ok: true } : { ok: false, reason: `exited with code ${ex.code}` };
    } else {
      if (isLogReady()) return { ok: true };
      if (ex) return { ok: false, reason: `process exited (code ${ex.code ?? ex.sig}) before it was ready` };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { ok: false, reason: `not ready after ${Math.round(timeoutMs / 1000)}s` };
}
