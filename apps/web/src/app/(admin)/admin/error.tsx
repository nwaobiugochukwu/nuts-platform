"use client";

import { RouteError } from "@/components/feedback/RouteError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      area="this admin page"
      homeHref="/admin"
      homeLabel="Back to dashboard"
    />
  );
}
