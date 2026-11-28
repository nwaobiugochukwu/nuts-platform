#!/usr/bin/env node
// Fails when the migrations and packages/database/schema.prisma describe different databases.
//
//   DRIFT_DATABASE_URL=postgresql://user:pass@host:5432/empty_db node scripts/check-schema-drift.mjs
//
// It applies every migration to an EMPTY database, then asks Prisma what would still have to
// change to reach schema.prisma. The only differences allowed are indexes Prisma cannot declare (the trigram search indexes and
// the wallet ledger's partial unique indexes): they live in migrations and would otherwise always show up.
// The database must be empty and disposable; the script refuses to run against one with tables.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps/api');
const schema = path.join(root, 'packages/database/schema.prisma');
const url = process.env.DRIFT_DATABASE_URL;

if (!url) {
  console.error('Set DRIFT_DATABASE_URL to an empty, disposable PostgreSQL database.');
  process.exit(2);
}

const require = createRequire(path.join(apiDir, 'package.json'));
const { Client } = require('pg');
const client = new Client({ connectionString: url.replace(/\?.*$/, '') });
await client.connect();
const { rows } = await client.query(
  "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
);
await client.end();
if (rows[0].n > 0) {
  console.error(`Refusing to run: the database already has ${rows[0].n} table(s). Use an empty one.`);
  process.exit(2);
}

const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
const prisma = (args) =>
  spawnSync('npx', ['prisma', ...args], { cwd: apiDir, env, encoding: 'utf8' });

const deploy = prisma(['migrate', 'deploy']);
if (deploy.status !== 0) {
  console.error('Applying the migrations to an empty database failed:\n' + deploy.stdout + deploy.stderr);
  process.exit(1);
}

const diff = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', schema, '--script']);
if (diff.status !== 0) {
  console.error('prisma migrate diff failed:\n' + diff.stdout + diff.stderr);
  process.exit(1);
}

// Indexes Prisma cannot declare: trigram search indexes, and the partial unique indexes that make a
// wallet ledger entry exist at most once (`*_once_idx`).
const ALLOWED = /^DROP INDEX "[A-Za-z0-9_]+_(trgm|once)_idx";$/;
const unexpected = diff.stdout
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('--') && !/^(BEGIN|COMMIT);$/.test(line))
  .filter((line) => !line.startsWith('◇') && !line.startsWith('Loaded Prisma config'))
  .filter((line) => !ALLOWED.test(line));

if (unexpected.length > 0) {
  console.error('Schema drift: the migrations do not produce schema.prisma. Still to change:\n');
  for (const line of unexpected) console.error('  ' + line);
  console.error('\nAdd a migration (or change schema.prisma) so they agree.');
  process.exit(1);
}
console.log('No schema drift (trigram search indexes are allowed).');
