import { execSync, spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import path from 'node:path';

let child = null;
let timer = null;
let isShuttingDown = false;

function startServer() {
  if (isShuttingDown) return;

  const mainPath = path.resolve(process.cwd(), 'dist/main.js');
  if (!existsSync(mainPath)) {
    console.log('[api] Waiting for dist/main.js to be compiled...');
    return;
  }

  if (child && child.pid) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // Child might already be dead
    }
  }

  child = spawn(
    process.execPath,
    ['-r', 'tsconfig-paths/register', 'dist/main.js'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        TS_NODE_PROJECT: 'tsconfig.runtime.json',
      },
    },
  );

  child.on('exit', (code, signal) => {
    if (!isShuttingDown && signal !== 'SIGTERM' && code !== null && code !== 0) {
      console.log(`[api] Server exited with code ${code}. Waiting for code changes...`);
    }
  });
}

function queueRestart() {
  if (isShuttingDown) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log('[api] Build changes detected, reloading server...');
    startServer();
  }, 400);
}

// Watch dist/ folder with debounce and filter out declarations and maps
if (existsSync('dist')) {
  try {
    watch('dist', { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const lower = filename.toLowerCase();
      // Ignore typescript declarations, source maps, and build metadata
      if (
        lower.endsWith('.d.ts') ||
        lower.endsWith('.map') ||
        lower.endsWith('.tsbuildinfo')
      ) {
        return;
      }
      if (lower.endsWith('.js')) {
        queueRestart();
      }
    });
  } catch (err) {
    console.warn('[api] Directory watch initialization warning:', err.message);
  }
}

function cleanup() {
  isShuttingDown = true;
  clearTimeout(timer);
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start initial server instance
startServer();
