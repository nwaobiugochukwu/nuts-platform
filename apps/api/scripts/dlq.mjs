#!/usr/bin/env node
/**
 * Dead-letter queue tool.
 *
 *   node scripts/dlq.mjs list                       show what is in the DLQ (nothing is removed)
 *   node scripts/dlq.mjs replay [--queue q.nuts.emails] [--limit 50] [--dry-run] [--force]
 *   node scripts/dlq.mjs purge  [--queue q.nuts.emails] --yes
 *
 * Needs a built API (`npm run build`) and RABBITMQ_URL (read from .env.<NODE_ENV>).
 * Replay republishes a message to the events exchange with its original routing
 * key and acknowledges it only after the broker confirms; a message replayed
 * more than 3 times is skipped unless --force is given.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env.NODE_ENV || 'development';
for (const file of [`.env.${env}.local`, `.env.${env}`, '.env']) {
  try {
    require('dotenv').config({ path: path.join(root, file), quiet: true });
  } catch {
    /* optional */
  }
}
require('tsconfig-paths').register({
  baseUrl: path.join(root, 'dist'),
  paths: { '@api/*': ['*'] },
});
const amqp = require('amqplib');
const { describeDeadLetter, planReplay } = require(
  path.join(root, 'dist/infrastructure/rabbitmq/dlq.util.js'),
);
const { RABBITMQ_QUEUES } = require(
  path.join(root, 'dist/infrastructure/rabbitmq/rabbitmq.constants.js'),
);

const [command = 'help', ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const option = (name, fallback) => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : fallback;
};

async function drain(channel, handler) {
  const snapshot = (await channel.checkQueue(RABBITMQ_QUEUES.DLQ)).messageCount;
  const held = [];
  for (let i = 0; i < snapshot; i += 1) {
    const message = await channel.get(RABBITMQ_QUEUES.DLQ, { noAck: false });
    if (!message) break;
    held.push(message);
  }
  for (const message of held) await handler(message);
  return held.length;
}

async function main() {
  if (!['list', 'replay', 'purge'].includes(command)) {
    console.log('Usage: dlq.mjs list | replay [--queue Q] [--limit N] [--dry-run] [--force] | purge [--queue Q] --yes');
    return;
  }
  const url = process.env.RABBITMQ_URL;
  if (!url) throw new Error('RABBITMQ_URL is not set');
  const connection = await amqp.connect(url);
  const channel = await connection.createConfirmChannel();
  const wantQueue = option('queue');
  const limit = Number(option('limit', Infinity));
  let acted = 0;

  const total = await drain(channel, async (message) => {
    const info = describeDeadLetter(message);
    const selected = (!wantQueue || info.originalQueue === wantQueue) && acted < limit;

    if (command === 'list' || !selected) {
      if (command === 'list') {
        console.log(`${info.originalQueue ?? '?'}  ${info.routingKey ?? '?'}  ${info.reason ?? '?'}  deaths=${info.deaths} replays=${info.replays}  req=${info.requestId ?? '-'}\n    ${info.preview}`);
      }
      channel.nack(message, false, true); // put it back untouched
      return;
    }
    if (command === 'purge') {
      if (!flag('yes')) {
        channel.nack(message, false, true);
        return;
      }
      channel.ack(message);
      acted += 1;
      return;
    }
    // replay
    const plan = planReplay(message, { force: flag('force') });
    if (!plan.allowed) {
      console.log(`skip ${info.originalQueue ?? '?'}: ${plan.reason}`);
      channel.nack(message, false, true);
      return;
    }
    if (flag('dry-run')) {
      console.log(`would replay -> ${plan.routingKey} (${info.originalQueue})`);
      channel.nack(message, false, true);
      acted += 1;
      return;
    }
    await new Promise((resolve, reject) => {
      channel.publish(plan.exchange, plan.routingKey, message.content, {
        persistent: true,
        contentType: 'application/json',
        headers: plan.headers,
      }, (error) => (error ? reject(error) : resolve()));
    });
    channel.ack(message);
    acted += 1;
    console.log(`replayed -> ${plan.routingKey} (${info.originalQueue})`);
  });

  if (command === 'purge' && !flag('yes')) console.log('Nothing purged: add --yes to confirm.');
  console.log(`${total} message(s) in the dead-letter queue; ${command === 'list' ? 'listed' : `${command === 'purge' ? 'purged' : flag('dry-run') ? 'would replay' : 'replayed'} ${acted}`}.`);
  await channel.close();
  await connection.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
