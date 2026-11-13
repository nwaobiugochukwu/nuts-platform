import { serverFetch } from "@/api/core/server-fetcher";
import type { CartResponseDto } from "@/api/dto/cart";

/**
 * Server-side Cart retrieval forwarding session cookies.
 */
export async function serverGetCart(): Promise<CartResponseDto | null> {
  return serverFetch<CartResponseDto>("/cart", {
    revalidate: 0,
    forwardCookies: true,
  });
}
