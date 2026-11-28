// Layout and naming rules for apps/api, kept as plain functions so they can be tested.
// Used by scripts/check-architecture.mjs. The standard is described in
// docs/architecture/event-driven-and-resilience-audit.md, section 6.

/** File kinds (`<name>.<kind>.ts`). */
export const ALLOWED_KINDS = new Set([
  "module", "controller", "service", "consumer", "job", "listener", "guard", "interceptor", "pipe", "filter",
  "middleware", "decorator", "dto", "enum", "constants", "types", "mapper", "util",
  // technical roles already in use
  "config", "strategy", "provider", "validator", "validation", "exception", "storage", "throttler", "relay",
  "health", "workflow", "activities", "templates", "extractor", "setup",
]);

/** For these kinds the exported class must be PascalCase(<name>) + the suffix, so file and class always agree. */
export const CLASS_SUFFIX = {
  module: "Module", controller: "Controller", service: "Service", consumer: "Consumer", job: "Job",
  listener: "Listener", guard: "Guard", interceptor: "Interceptor", pipe: "Pipe", filter: "Filter",
  middleware: "Middleware", strategy: "Strategy", provider: "Provider",
};

/** Files with no kind: program entry points and start-up files. Relative to apps/api/src. */
export const NO_KIND_FILES = new Set([
  "main.ts", "bootstrap/worker.ts", "bootstrap/temporal-worker.ts", "bootstrap/instrument.ts", "bootstrap/load-env.ts",
]);

/** The only folders a module may contain (besides its own `*.module.ts` files). */
export const MODULE_FOLDERS = new Set([
  "controllers", "services", "dto", "consumers", "events", "jobs", "listeners", "guards", "decorators",
  "interceptors", "strategies", "middleware", "templates", "constants", "types", "utils", "mappers", "pipes",
  "throttler", "tests",
]);

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Words whose conventional capitalisation is not just a capital first letter.
const WORDS = { rabbitmq: "RabbitMQ" };
export const pascal = (kebab) =>
  kebab.split("-").map((p) => WORDS[p] ?? p.charAt(0).toUpperCase() + p.slice(1)).join("");

/** `<name>.<kind>[.spec].ts` -> parts, or null when the name has no kind. */
export function parseFileName(name) {
  const spec = name.endsWith(".spec.ts");
  const base = spec ? name.slice(0, -8) : name.replace(/\.ts$/, "");
  const m = base.match(/^(.*)\.([a-z-]+)$/);
  return m ? { stem: m[1], kind: m[2], spec } : { stem: base, kind: null, spec };
}

/** Problems with one file's name. `relFromSrc` is the path under apps/api/src. */
export function checkFileName(relFromSrc) {
  const name = relFromSrc.split("/").pop();
  if (name === "index.ts" || name.endsWith(".d.ts") || name.endsWith("-spec.ts")) return [];
  if (NO_KIND_FILES.has(relFromSrc)) return [];
  const { stem, kind, spec } = parseFileName(name);
  const problems = [];
  if (!KEBAB.test(stem)) problems.push(`"${name}": the name part "${stem}" must be kebab-case`);
  if (spec) return problems; // specs may carry any subject kind
  if (!kind) problems.push(`"${name}" has no kind; use <name>.<kind>.ts (kinds: ${[...ALLOWED_KINDS].join(", ")})`);
  else if (!ALLOWED_KINDS.has(kind)) problems.push(`"${name}": "${kind}" is not an allowed kind`);
  return problems;
}

/** The class a file of a suffix kind must export, or null when the file has no such rule. */
export function expectedClassName(name) {
  const { stem, kind, spec } = parseFileName(name);
  if (spec || !kind || !CLASS_SUFFIX[kind]) return null;
  return pascal(stem) + CLASS_SUFFIX[kind];
}

export function exportedClasses(source) {
  return [...source.matchAll(/^export\s+(?:abstract\s+)?class\s+(\w+)/gm)].map((m) => m[1]);
}

export function checkClassName(relFromSrc, source) {
  const name = relFromSrc.split("/").pop();
  const expected = expectedClassName(name);
  if (!expected) return [];
  const classes = exportedClasses(source);
  if (classes.length === 0 || classes.includes(expected)) return [];
  return [`"${name}" must export class ${expected} (found ${classes.join(", ")})`];
}

/** A module's top level: only its own *.module.ts files and the standard folders. relFromModule is e.g. "services/a.service.ts". */
export function checkModuleEntry(relFromModule) {
  const first = relFromModule.split("/")[0];
  if (!relFromModule.includes("/")) return /\.module\.ts$/.test(first) || /\.module\.spec\.ts$/.test(first) || first === "index.ts" || first.endsWith("-spec.ts") || first.endsWith(".spec.ts")
    ? [] : [`"${first}" sits at the module root; put it in the folder for its kind`];
  return MODULE_FOLDERS.has(first) ? [] : [`folder "${first}" is not a standard module folder (${[...MODULE_FOLDERS].join(", ")})`];
}

/** Consumers live in a module's `consumers/` folder or in infrastructure/workflows. */
export function checkConsumerLocation(relFromSrc) {
  if (!/\.consumer\.ts$/.test(relFromSrc)) return [];
  if (/^modules\/[^/]+\/consumers\//.test(relFromSrc) || relFromSrc.startsWith("infrastructure/workflows/")) return [];
  return [`queue consumers belong in modules/<domain>/consumers/ (or infrastructure/workflows); found ${relFromSrc}`];
}

/** A module's unit tests live in its `tests/` folder (mirroring the folders of what they test), not beside the source. */
export function checkSpecLocation(relFromSrc) {
  const m = relFromSrc.match(/^modules\/([^/]+)\/(.+\.spec\.ts)$/);
  if (!m) return [];
  return /^tests\/[^/]+$/.test(m[2]) ? [] : [`specs belong directly in modules/${m[1]}/tests/ (no subfolders); found ${relFromSrc}`];
}

/** Internal aliases other than @api/* are not allowed. */
export function checkAlias(spec) {
  return /^@(common|infra|infrastructure|modules)\//.test(spec) ? [`import "${spec}" uses a removed alias; use @api/*`] : [];
}
