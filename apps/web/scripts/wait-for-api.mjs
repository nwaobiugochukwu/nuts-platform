import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// npm lifecycle hooks run before Next loads its env files, so load the same
// development files here to wait on the API target the web app will actually use.
if (typeof process.loadEnvFile === "function") {
  for (const name of [
    ".env.development.local",
    ".env.local",
    ".env.development",
    ".env",
  ]) {
    try {
      process.loadEnvFile(path.join(appDir, name));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

const apiBase =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:3001";
const healthUrl = new URL("/api/v1/health", apiBase);
const configuredTimeout = Number(process.env.WEB_API_STARTUP_TIMEOUT_MS);
const timeoutMs =
  Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 120_000;
const startedAt = Date.now();
let lastStatus = "no response";
let apiReady = false;

console.log(`[web:dev] Waiting for API health at ${healthUrl.origin}/api/v1/health`);

while (Date.now() - startedAt < timeoutMs) {
  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });

    if (response.ok) {
      await response.body?.cancel();
      console.log("[web:dev] API is ready; starting Next.js.");
      apiReady = true;
      break;
    }

    lastStatus = `HTTP ${response.status}`;
    await response.body?.cancel();
  } catch (error) {
    lastStatus = error instanceof Error ? error.message : String(error);
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!apiReady) {
  console.error(
    `[web:dev] API did not become healthy within ${Math.round(timeoutMs / 1000)}s (${lastStatus}). ` +
      "Start the API with `npm run dev` from the repository root or `npm run dev:api` in another terminal. " +
      "Override WEB_API_STARTUP_TIMEOUT_MS if a cold API build needs longer.",
  );
  process.exitCode = 1;
}
