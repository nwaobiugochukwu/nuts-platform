#!/usr/bin/env node
/**
 * Waits until the compiled entry point exists, then exits 0.
 *
 *   node scripts/wait-for-dist.mjs dist/main.js
 *
 * The api, worker and jobs each start independently of the compiler (they only
 * run what it builds). On a fresh checkout `dist/` does not exist yet, so each
 * program waits here instead of crashing and restarting until the first build
 * finishes. Gives up after two minutes with a clear message.
 */
import { existsSync } from 'node:fs';

const target = process.argv[2];
if (!target) {
  console.error('usage: wait-for-dist.mjs <file>');
  process.exit(2);
}

const deadline = Date.now() + 120_000;
let announced = false;
while (!existsSync(target)) {
  if (!announced) {
    console.log(`Waiting for the compiler to build ${target} (is "dev:compile" running?)...`);
    announced = true;
  }
  if (Date.now() > deadline) {
    console.error(`Gave up waiting for ${target}. Start the compiler: npm run dev:compile`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
