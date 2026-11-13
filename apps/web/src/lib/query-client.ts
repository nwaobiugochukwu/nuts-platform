"use client";

import { QueryClient } from "@tanstack/react-query";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
        retry: (failureCount, error) => {
          const status =
            typeof error === "object" && error !== null && "response" in error
              ? (error as { response?: { status?: number } }).response?.status
              : undefined;
          if (status !== undefined && status >= 400 && status < 500) return false;
          return failureCount < 1;
        },
        retryDelay: (attempt) => Math.min(250 * 2 ** attempt, 1000),
        refetchOnWindowFocus: false,
        refetchOnMount: true,
        refetchOnReconnect: true,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return createQueryClient();
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}

export function clearBrowserQueryClient(): void {
  if (!browserQueryClient) return;
  browserQueryClient.removeQueries({
    predicate: (query) => {
      const firstKey = String(query.queryKey[0]);
      return firstKey !== "category" && firstKey !== "categories";
    },
  });
}
