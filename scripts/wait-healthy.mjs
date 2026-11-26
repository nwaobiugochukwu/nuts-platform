#!/usr/bin/env node
// Wait until a URL answers 200, or give up.
//   node scripts/wait-healthy.mjs <url> [--timeout 90]
// Exit code 0 = healthy, 1 = timed out. Used by the ordered launcher and the VS Code tasks.
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitHealthy(url, { timeoutMs = 90_000, intervalMs = 500, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer yet';
  while (Date.now() < deadline) {
    if (signal?.aborted) return { ok: false, reason: 'cancelled' };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.status === 200) return { ok: true };
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err?.cause?.code ?? err?.name ?? 'connection failed';
    }
    await sleep(intervalMs);
  }
  return { ok: false, reason: `${url} not healthy after ${Math.round(timeoutMs / 1000)}s (last: ${last})` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--timeout');
  const t = args.indexOf('--timeout');
  const seconds = t >= 0 ? Number(args[t + 1]) : 90;
  if (!url || !Number.isFinite(seconds) || seconds <= 0) {
    console.error('Usage: node scripts/wait-healthy.mjs <url> [--timeout <seconds>]');
    process.exit(2);
  }
  console.log(`Waiting for ${url} (up to ${seconds}s)...`);
  const result = await waitHealthy(url, { timeoutMs: seconds * 1000 });
  if (result.ok) {
    console.log(`Healthy: ${url}`);
  } else {
    console.error(`FAILED: ${result.reason}`);
    process.exit(1);
  }
}
