import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads environment variables following a 12-factor production cascade.
 *
 * Precedence:
 * 1. Process environment (OS / Container / CI / PaaS) — NEVER overwritten.
 * 2. .env.${NODE_ENV}.local (local developer override for current environment)
 * 3. .env.local (local developer override for all non-test environments)
 * 4. .env.${NODE_ENV} (e.g. .env.development, .env.production, .env.staging)
 * 5. .env (base fallback)
 */
export function loadAppEnv(): void {
  const cwd = process.cwd();

  // Resolve directory of the API app whether launched from root or apps/api
  const appDir = fs.existsSync(path.resolve(cwd, 'src/main.ts'))
    ? cwd
    : fs.existsSync(path.resolve(cwd, 'apps/api/src/main.ts'))
      ? path.resolve(cwd, 'apps/api')
      : cwd;

  // If NODE_ENV is not set in process.env, check if base .env specifies it
  let currentEnv = process.env.NODE_ENV;
  if (!currentEnv) {
    const baseEnvPath = path.resolve(appDir, '.env');
    if (fs.existsSync(baseEnvPath)) {
      try {
        const parsed = dotenv.parse(fs.readFileSync(baseEnvPath));
        if (parsed.NODE_ENV) {
          currentEnv = parsed.NODE_ENV;
          process.env.NODE_ENV = parsed.NODE_ENV;
        }
      } catch {
        // Ignore parse error; will fallback to development
      }
    }
  }

  // If still not set, default to development
  if (!currentEnv) {
    currentEnv = 'development';
    process.env.NODE_ENV = 'development';
  }

  const candidateFiles = [
    `.env.${currentEnv}.local`,
    currentEnv !== 'test' ? '.env.local' : null,
    `.env.${currentEnv}`,
    '.env',
  ].filter(Boolean) as string[];

  for (const file of candidateFiles) {
    const fullPath = path.resolve(appDir, file);
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath, quiet: true });
    }
  }
}

// Auto-execute on import
loadAppEnv();
