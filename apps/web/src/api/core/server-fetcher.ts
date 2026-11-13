import { cookies } from "next/headers";
import { connection } from "next/server";

const API_BASE =
  (process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://localhost:3001") + "/api/v1";

const isDevEnv = process.env.NODE_ENV === "development";
const FETCH_RETRIES = 2;
const FETCH_RETRY_MS = 100;
const FETCH_TIMEOUT_MS =
  Number(process.env.SERVER_FETCH_TIMEOUT_MS) || (isDevEnv ? 15_000 : 3_500);
const SLOW_UPSTREAM_MS = Number(process.env.SERVER_FETCH_SLOW_MS) || 1_000;

export interface ServerEnvelope<T> {
  success?: boolean;
  statusCode?: number;
  message?: string;
  data: T;
  meta?: unknown;
}

export interface ServerFetchOptions {
  revalidate?: number | false;
  tags?: string[];
  cookiesHeader?: string;
  forwardCookies?: boolean;
  includeHttpErrorStatus?: boolean;
}

function isTransientNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  const cause = typeof err.cause === "object" && err.cause !== null
    ? (err.cause as Record<string, unknown>)
    : undefined;
  const code = typeof err.code === "string" ? err.code : typeof cause?.code === "string" ? cause.code : "";
  const message = typeof err.message === "string" ? err.message : "";
  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    /fetch failed|ECONNREFUSED|ETIMEDOUT/i.test(message)
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Robust server-side HTTP fetcher for React Server Components (RSC).
 * Supports Next.js cache revalidation tags, cookie forwarding, and transient retry resilience.
 */
export async function serverFetchEnvelope<T>(
  endpoint: string,
  options: ServerFetchOptions = {}
): Promise<{ data: T; meta?: unknown; statusCode?: number } | null> {
  // Storefront API data must be read at request time. This keeps production
  // builds independent of a live API and lets Next's fetch revalidation cache
  // public responses after the first real request.
  await connection();

  const url = `${API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const endpointPath = new URL(url).pathname;

  let cookieHeader = options.cookiesHeader;
  if (!cookieHeader && options.forwardCookies) {
    try {
      const cookieStore = await cookies();
      cookieHeader = cookieStore.toString();
    } catch {
      // In static generation context, cookies() throws. Handled safely.
    }
  }

  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const requestStartedAt = performance.now();
      const isDev = process.env.NODE_ENV === "development";
      // Keep development requests fresh by default, while honoring explicit cache
      // durations for public data such as product and category details.
      const revalidate =
        options.revalidate !== undefined
          ? options.revalidate
          : isDev
            ? 0
            : 60;

      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-NG,en;q=0.9",
          "User-Agent": "NUTS-Commerce-Web-Server/1.0",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        cache: revalidate === 0 || revalidate === false ? "no-store" : undefined,
        next:
          typeof revalidate === "number" && revalidate > 0
            ? {
                revalidate,
                tags: options.tags,
              }
            : undefined,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) {
        if (process.env.NODE_ENV === "development") {
          console.warn(`[serverFetch] Upstream ${endpointPath} returned HTTP ${res.status}`);
        }
        if (options.includeHttpErrorStatus) {
          return { data: null as T, meta: undefined, statusCode: res.status };
        }
        if (res.status === 404) return null;
        return null;
      }

      const payload: unknown = await res.json();
      const durationMs = Math.round(performance.now() - requestStartedAt);
      if (process.env.NODE_ENV === "development" && durationMs > SLOW_UPSTREAM_MS) {
        console.warn(`[serverFetch] Slow upstream ${endpointPath}: ${durationMs}ms`);
      }
      if (payload && typeof payload === "object" && "data" in payload) {
        const envelope = payload as ServerEnvelope<T>;
        return {
          data: envelope.data,
          meta: envelope.meta,
        };
      }
      return { data: payload as T, meta: null };
    } catch (error: unknown) {
      const cause = error && typeof error === "object" && "cause" in error && typeof error.cause === "object" && error.cause !== null
        ? error.cause as Record<string, unknown>
        : undefined;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : typeof cause?.code === "string" ? cause.code : "";
      const message = error instanceof Error ? error.message : "";
      const name = error instanceof Error ? error.name : "";
      if (code === "ECONNREFUSED") {
        // Fast fail: backend is not listening, do not stall page
        return null;
      }
      const isTimeout = name === "TimeoutError" || name === "AbortError";
      if (attempt < FETCH_RETRIES && (isTransientNetworkError(error) || isTimeout)) {
        await sleep(FETCH_RETRY_MS * attempt);
        continue;
      }
      if (process.env.NODE_ENV === "development") {
        console.warn(`[serverFetch] Failed ${endpointPath}:`, message || error);
      }
      return null;
    }
  }

  return null;
}

export async function serverFetch<T>(
  endpoint: string,
  options: ServerFetchOptions = {}
): Promise<T | null> {
  const result = await serverFetchEnvelope<T>(endpoint, options);
  return result ? result.data : null;
}
