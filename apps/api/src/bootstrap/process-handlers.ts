import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/** The few parts of `process` this needs, so a test can pass a stand-in. */
export interface ProcessLike {
  on(
    event: 'unhandledRejection' | 'uncaughtException',
    listener: (arg: unknown) => void,
  ): unknown;
}

export interface ProcessHandlerOptions {
  /** Which program this is (api, worker, jobs, temporal-worker); goes on every report. */
  program: string;
  target?: ProcessLike;
  exit?: (code: number) => void;
  /** Reports the error and waits for it to be sent; defaults to Sentry. */
  report?: (error: Error, tags: Record<string, string>) => Promise<unknown>;
  /** The longest to wait before leaving anyway, in milliseconds. */
  graceMs?: number;
}

let installed = false;

/**
 * Last line of defence for a program: an unhandled promise rejection or an uncaught
 * exception means the process is in an unknown state, so it logs one structured line,
 * reports the error, and exits non-zero so PM2 (or the platform) restarts it cleanly.
 * Without this, Node prints a bare stack to stderr and the report can be lost.
 */
export function installProcessErrorHandlers(
  options: ProcessHandlerOptions,
): void {
  if (installed && !options.target) return;
  installed = true;

  const target = options.target ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const graceMs = options.graceMs ?? 3_000;
  const report =
    options.report ??
    (async (error: Error, tags: Record<string, string>) => {
      Sentry.captureException(error, { tags });
      await Sentry.flush(2_000);
    });
  const logger = new Logger('Process');
  let leaving = false;

  const fatal = (kind: string, reason: unknown): void => {
    if (leaving) return;
    leaving = true;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(
      { program: options.program, kind, errorName: error.name },
      `${kind} in ${options.program}: ${error.message}`,
      error.stack,
    );
    // Never hang while trying to report.
    const timer = setTimeout(() => exit(1), graceMs);
    timer.unref();
    report(error, { program: options.program, kind })
      .catch(() => undefined)
      .finally(() => exit(1));
  };

  target.on('unhandledRejection', (reason) =>
    fatal('unhandledRejection', reason),
  );
  target.on('uncaughtException', (error) => fatal('uncaughtException', error));
}
