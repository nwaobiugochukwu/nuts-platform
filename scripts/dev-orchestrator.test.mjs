import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runSequence } from './dev-orchestrator.mjs';
import { waitHealthy } from './wait-healthy.mjs';

const node = process.execPath;
const js = (code) => ({ command: node, args: ['-e', code] });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function serverAfter(delayMs) {
  return new Promise((resolve) => {
    const server = http.createServer((_, res) => res.end('ok'));
    setTimeout(() => server.listen(0, '127.0.0.1', () => resolve(server)), delayMs);
  });
}

test('waitHealthy succeeds once the server answers 200', async () => {
  const port = 38000 + Math.floor(Math.random() * 1000);
  const server = http.createServer((_, res) => res.end('ok'));
  setTimeout(() => server.listen(port, '127.0.0.1'), 700);
  const r = await waitHealthy(`http://127.0.0.1:${port}/`, { timeoutMs: 5000, intervalMs: 100 });
  server.close();
  assert.equal(r.ok, true);
});

test('waitHealthy times out when nothing answers', async () => {
  const r = await waitHealthy('http://127.0.0.1:1/', { timeoutMs: 800, intervalMs: 100 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not healthy after/);
});

test('steps run strictly in order: the next starts only after the previous is ready', async () => {
  const lines = [];
  const { results } = await runSequence([
    { name: 'a', ...js("setTimeout(()=>{console.log('A READY');setInterval(()=>{},1000)},500)"), ready: { log: /A READY/ } },
    { name: 'b', ...js("console.log('B READY');setInterval(()=>{},1000)"), ready: { log: /B READY/ } },
  ], { out: (l) => lines.push(l), defaultTimeoutMs: 5000 }).then(async (r) => { await r.stop(); return r; });
  const text = lines.join('\n');
  assert.ok(text.indexOf('[a] ready') < text.indexOf('[b] starting'), text);
  assert.deepEqual(results.map((r) => r.status), ['ready', 'ready']);
});

test('a step that fails does not stop later steps; summary reports it', async () => {
  const lines = [];
  const r = await runSequence([
    { name: 'bad', ...js('process.exit(3)'), ready: { log: /never/ } },
    { name: 'good', ...js("console.log('UP');setInterval(()=>{},1000)"), ready: { log: /UP/ } },
  ], { out: (l) => lines.push(l), defaultTimeoutMs: 5000 });
  await r.stop();
  assert.deepEqual(r.results.map((x) => x.status), ['failed', 'ready']);
  assert.match(lines.join('\n'), /FAILED bad/);
  assert.match(lines.join('\n'), /OK\s+good/);
});

test('http readiness waits for the health endpoint; timeout is reported and the next step still runs', async () => {
  const server = await serverAfter(0);
  const port = server.address().port;
  const r = await runSequence([
    { name: 'svc', ...js('setInterval(()=>{},1000)'), ready: { http: `http://127.0.0.1:${port}/` } },
    { name: 'dead', ...js('setInterval(()=>{},1000)'), ready: { http: 'http://127.0.0.1:1/' }, timeoutMs: 800 },
    { name: 'after', ...js("console.log('UP');setInterval(()=>{},1000)"), ready: { log: /UP/ } },
  ], { out: () => {}, defaultTimeoutMs: 5000 });
  await r.stop();
  server.close();
  assert.deepEqual(r.results.map((x) => x.status), ['ready', 'failed', 'ready']);
});

test('stop() terminates every child, including grandchildren', async () => {
  const lines = [];
  const r = await runSequence([
    { name: 'parent', ...js("const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log('CHILD '+c.pid);setInterval(()=>{},1000)"), ready: { log: /CHILD \d+/ } },
  ], { out: (l) => lines.push(l), defaultTimeoutMs: 5000 });
  const grand = Number(/CHILD (\d+)/.exec(lines.join('\n'))[1]);
  const parent = [...r.children][0].pid;
  assert.ok(alive(parent) && alive(grand));
  await r.stop();
  await new Promise((x) => setTimeout(x, 300));
  assert.equal(alive(parent), false);
  assert.equal(alive(grand), false);
});

test('quiet mode hides service output but writes it to per-service log files', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'devlogs-'));
  const lines = [];
  const r = await runSequence([
    { name: 'svc', ...js("console.log('SECRET LINE');console.log('UP');setInterval(()=>{},1000)"), ready: { log: /UP/ } },
  ], { out: (l) => lines.push(l), defaultTimeoutMs: 5000, logDir: dir, quiet: true });
  await r.stop();
  await new Promise((x) => setTimeout(x, 200));
  assert.ok(!lines.join('\n').includes('SECRET LINE'));
  assert.match(readFileSync(join(dir, 'svc.log'), 'utf8'), /SECRET LINE/);
});
