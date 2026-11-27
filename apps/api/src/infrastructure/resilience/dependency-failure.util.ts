/**
 * Decides whether an error means the *dependency* is unhealthy (so a circuit breaker should
 * count it, and a repeatable call may be retried) or the *request* was bad (so it should not).
 *
 * Counts: timeouts, network errors, HTTP 5xx and 429.
 * Does not count: HTTP 4xx other than 429 (bad input, wrong credentials, not found), an open
 * circuit, and errors from our own code, which carry no status and no network code.
 */

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const TIMEOUT_NAMES = new Set([
  'TaskCancelledError',
  'TimeoutError',
  'AbortError',
]);

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  cause?: unknown;
  status?: unknown;
  statusCode?: unknown;
  http_code?: unknown;
  upstreamStatus?: unknown;
  getStatus?: unknown;
};

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * The HTTP status the dependency answered with. `upstreamStatus` wins: our own wrappers may
 * rethrow an upstream 400 as a 503 for the API caller, and the breaker must see the real one.
 */
export function upstreamStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const e = error as ErrorLike;
  return (
    asNumber(e.upstreamStatus) ??
    asNumber(e.status) ??
    asNumber(e.statusCode) ??
    asNumber(e.http_code) ??
    (typeof e.getStatus === 'function'
      ? asNumber((e.getStatus as () => unknown).call(error))
      : undefined)
  );
}

/** Marks an error with the status the dependency really returned. */
export function withUpstreamStatus<T extends Error>(
  error: T,
  status: number,
): T {
  return Object.assign(error, { upstreamStatus: status });
}

export function isDependencyFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as ErrorLike;
  if (e.name === 'BrokenCircuitError') return false;
  if (typeof e.name === 'string' && TIMEOUT_NAMES.has(e.name)) return true;
  if (typeof e.code === 'string' && NETWORK_CODES.has(e.code)) return true;
  const cause = e.cause as ErrorLike | undefined;
  if (
    cause &&
    typeof cause.code === 'string' &&
    NETWORK_CODES.has(cause.code)
  ) {
    return true;
  }
  const status = upstreamStatusOf(error);
  if (status !== undefined) return status >= 500 || status === 429;
  return false;
}
