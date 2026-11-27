#!/usr/bin/env node
// Calls every parameter-free GET route listed in the running API's OpenAPI document and
// fails on any server error (5xx). Use it against a dev stack, or after a deploy.
//
//   node scripts/smoke-routes.mjs [baseUrl] [--origin <url>] [--max-ms <n>]
//
// baseUrl defaults to http://localhost:3001. The API documents itself at /api/docs-json
// only where Swagger is enabled (development, or staging when switched on); where it is
// not, the script says so and exits 0 without checking anything.
// Routes that need a signed-in user answer 401 or 403, which is correct and not a failure.
import { pathToFileURL } from 'node:url';

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SESSION_ID = '6f1c1d1a-8b52-4a43-9a77-0c4f2f1b9e11';

/** The GET paths worth calling: no `{param}` segments. */
export function selectRoutes(openApi) {
  return Object.entries(openApi?.paths ?? {})
    .filter(([path, methods]) => methods?.get && !path.includes('{'))
    .map(([path]) => path)
    .sort();
}

/** Some public routes insist on a session id; give them a valid-looking one. */
export function withQuery(path) {
  return /recommend|discover/.test(path) ? `${path}?sessionId=${SESSION_ID}` : path;
}

export function summarise(results) {
  const byStatus = {};
  for (const { status } of results) byStatus[status] = (byStatus[status] ?? 0) + 1;
  return {
    byStatus,
    serverErrors: results.filter((r) => r.status >= 500 || r.status === 0),
  };
}

export async function smoke(baseUrl, { origin, maxMs = 5000, fetchImpl = fetch } = {}) {
  const headers = { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en', Origin: origin };
  const docs = await fetchImpl(`${baseUrl}/api/docs-json`, { headers });
  if (!docs.ok) return { skipped: `API documentation is not served (HTTP ${docs.status})` };

  const routes = selectRoutes(await docs.json());
  const results = [];
  for (const route of routes) {
    const started = Date.now();
    let status = 0;
    try {
      const res = await fetchImpl(`${baseUrl}${withQuery(route)}`, {
        headers,
        signal: AbortSignal.timeout(maxMs),
      });
      status = res.status;
      await res.arrayBuffer();
    } catch {
      status = 0; // no answer within the time limit, or the connection failed
    }
    results.push({ route, status, ms: Date.now() - started });
  }
  return { results, ...summarise(results) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const baseUrl = (args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:3001').replace(/\/$/, '');
  const origin = option('--origin', 'http://localhost:5173');
  const maxMs = Number(option('--max-ms', 5000));

  const outcome = await smoke(baseUrl, { origin, maxMs });
  if (outcome.skipped) {
    console.log(`Skipped: ${outcome.skipped}.`);
    process.exit(0);
  }
  console.log(`Called ${outcome.results.length} routes on ${baseUrl}:`, outcome.byStatus);
  const slow = outcome.results.filter((r) => r.ms > 1000).sort((a, b) => b.ms - a.ms).slice(0, 5);
  for (const r of slow) console.log(`  slow: ${r.route} took ${r.ms} ms`);
  if (outcome.serverErrors.length > 0) {
    console.error(`FAILED: ${outcome.serverErrors.length} route(s) answered with a server error or not at all:`);
    for (const r of outcome.serverErrors) console.error(`  ${r.status || 'no answer'}  ${r.route}`);
    process.exit(1);
  }
  console.log('No server errors.');
}
