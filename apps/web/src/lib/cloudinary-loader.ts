export interface CloudinaryLoaderParams {
  src: string;
  width: number;
  quality?: number;
}

/**
 * Next.js custom image loader for Cloudinary.
 * Injects automatic format negotiation (f_auto), responsive width limits (w_{width}),
 * and quality compression (q_{quality}) at the CDN edge.
 */
export default function cloudinaryLoader({
  src,
  width,
  quality,
}: CloudinaryLoaderParams): string {
  // If the source is not hosted on Cloudinary, pass through directly
  if (!src || !src.includes("res.cloudinary.com")) {
    return src;
  }

  // Extract base URL and the relative resource path
  // Standard format: https://res.cloudinary.com/<cloud_name>/image/upload/[transformations/]v<version>/<public_id>
  const uploadIndex = src.indexOf("/upload/");
  if (uploadIndex === -1) {
    return src;
  }

  const prefix = src.slice(0, uploadIndex + 8);
  const suffix = src.slice(uploadIndex + 8);

  const q = quality || "auto";
  const transforms = `f_auto,q_${q},w_${width},c_limit`;

  // Avoid duplicate injection if transformations are already present
  if (suffix.startsWith("f_auto") || suffix.startsWith("w_")) {
    return src;
  }

  return `${prefix}${transforms}/${suffix}`;
}

export function getOptimizedImageUrl(
  url: string | null | undefined,
  width = 600,
  quality = 80
): string {
  if (!url) return "/placeholder-product.png";
  return cloudinaryLoader({ src: url, width, quality });
}
