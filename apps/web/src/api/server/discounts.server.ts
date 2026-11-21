import { serverFetch } from "@/api/core/server-fetcher";
import type { PublicPlatformPromoDto } from "@/api/dto/discount";
import { cache } from "react";

/**
 * Server-side public platform promotional campaigns fetch.
 * Cached with 120s revalidation and per-request memoization.
 */
export const serverGetPlatformPromos = cache(
  async function serverGetPlatformPromos(): Promise<PublicPlatformPromoDto[]> {
    try {
      const data = await serverFetch<PublicPlatformPromoDto[]>(
        "/public/discounts/campaigns",
        {
          revalidate: 120,
          tags: ["discounts", "platform-promos"],
        },
      );
      if (Array.isArray(data)) return data;
      if (
        data &&
        typeof data === "object" &&
        "data" in data &&
        Array.isArray((data as { data: unknown }).data)
      ) {
        return (data as { data: PublicPlatformPromoDto[] }).data;
      }
      return [];
    } catch {
      return [];
    }
  },
);
