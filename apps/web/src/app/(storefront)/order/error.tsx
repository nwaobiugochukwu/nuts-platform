"use client";

import { RouteError } from "@/components/feedback/RouteError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      area="your orders"
      homeHref="/"
      homeLabel="Continue shopping"
    />
  );
}
