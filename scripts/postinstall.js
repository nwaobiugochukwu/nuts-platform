const { existsSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const requiredFiles = [
  'apps/api/package.json',
  'packages/database/schema.prisma',
];
const missingFiles = requiredFiles.filter((file) =>
  !existsSync(path.join(repositoryRoot, file)),
);

if (missingFiles.length > 0) {
  console.info(
    `[postinstall] Skipping Prisma generation; this install context is missing ${missingFiles.join(', ')}.`,
  );
  process.exit(0);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('[postinstall] npm did not provide its CLI path.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [npmCli, 'run', '--prefix', 'apps/api', 'db:generate'],
  { cwd: repositoryRoot, stdio: 'inherit' },
);

if (result.error) {
  console.error('[postinstall] Prisma generation could not start.', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
