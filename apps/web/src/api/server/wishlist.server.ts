import { serverFetch } from "@/api/core/server-fetcher";
import type { WishlistResponseDto } from "@/api/dto/wishlist";

/**
 * Server-side Wishlist retrieval forwarding session cookies.
 */
export async function serverGetWishlist(): Promise<WishlistResponseDto[]> {
  const data = await serverFetch<WishlistResponseDto[]>("/wishlist", {
    revalidate: 0,
    forwardCookies: true,
  });
  return Array.isArray(data) ? data : [];
}
