"use client";

import { RouteError } from "@/components/feedback/RouteError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      area="checkout"
      homeHref="/cart"
      homeLabel="Back to cart"
    />
  );
}
