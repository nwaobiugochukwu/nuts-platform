#!/usr/bin/env node
/**
 * Outbox tool: events the relay gave up on (status DEAD).
 *
 *   node scripts/outbox.mjs list                          show dead events (nothing changes)
 *   node scripts/outbox.mjs replay [--id <uuid>] [--dry-run]   put dead events back in the queue
 *
 * Replay resets a dead row to PENDING with 0 attempts, so the relay publishes it again.
 * Consumers must tolerate a duplicate: a replayed event may already have been delivered once.
 * Needs DATABASE_URL (read from .env.<NODE_ENV>).
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
const { Client } = require('pg');

const [command = 'help', ...rest] = process.argv.slice(2);
const dryRun = rest.includes('--dry-run');
const idIndex = rest.indexOf('--id');
const onlyId = idIndex >= 0 ? rest[idIndex + 1] : null;

if (!['list', 'replay'].includes(command)) {
  console.log('Usage: outbox.mjs list | replay [--id <uuid>] [--dry-run]');
  process.exit(command === 'help' ? 0 : 1);
}
const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
// Prisma-only URL parameter that the pg driver does not understand.
const url = new URL(raw);
url.searchParams.delete('pgbouncer');

const client = new Client({ connectionString: url.toString() });
await client.connect();
try {
  const filter = onlyId ? 'AND id = $1' : '';
  const params = onlyId ? [onlyId] : [];
  const { rows } = await client.query(
    `SELECT id, "eventType", attempts, "lastError", "createdAt"
       FROM outbox_events WHERE status = 'DEAD' ${filter} ORDER BY "createdAt"`,
    params,
  );
  if (rows.length === 0) {
    console.log('No dead outbox events.');
  } else {
    for (const row of rows) {
      console.log(
        `${row.id}  ${row.eventType}  attempts=${row.attempts}  ${row.createdAt.toISOString()}  ${row.lastError ?? ''}`,
      );
    }
  }
  if (command === 'replay' && rows.length > 0) {
    if (dryRun) {
      console.log(`Dry run: ${rows.length} event(s) would be replayed.`);
    } else {
      const result = await client.query(
        `UPDATE outbox_events
            SET status = 'PENDING', attempts = 0, next_attempt_at = NULL, "lastError" = NULL, "updatedAt" = now()
          WHERE status = 'DEAD' ${filter}`,
        params,
      );
      console.log(`Replayed ${result.rowCount} event(s); the relay will publish them within seconds.`);
    }
  }
} finally {
  await client.end();
}
