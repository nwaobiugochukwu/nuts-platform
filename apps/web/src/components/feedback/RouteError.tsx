"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Where the secondary "go back" link points. */
  homeHref?: string;
  homeLabel?: string;
  /** Plain-language context, e.g. "your checkout". */
  area?: string;
}

/**
 * Shared body for every route-segment `error.tsx`.
 *
 * A render/data error in one section must never blank the whole app or look
 * like a crash: it shows what happened, offers a retry, and a safe way out.
 * `digest` is Next's server-side error id, shown so support can find the log.
 */
export function RouteError({
  error,
  reset,
  homeHref = "/",
  homeLabel = "Go to homepage",
  area = "this page",
}: RouteErrorProps) {
  useEffect(() => {
    // Surfaces in the browser console and any attached error reporter.
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-7 w-7" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-semibold text-foreground">
        We couldn&apos;t load {area}
      </h1>
      <p className="text-sm text-muted-foreground">
        Something went wrong on our side. Your data is safe. Try again, and if
        it keeps happening, contact support.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
        <Link
          href={homeHref}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          <Home className="h-4 w-4" aria-hidden="true" />
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}
