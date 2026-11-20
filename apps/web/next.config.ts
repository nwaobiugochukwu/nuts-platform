import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Production tree-shaking optimizations for memory-constrained environments
  experimental: {
    optimizePackageImports: ["lucide-react", "@tanstack/react-query", "sonner"],
  },

  // Standalone output produces a lean production build containing only necessary dependencies
  output: "standalone",

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },

  async rewrites() {
    // INTERNAL_API_URL is the container-to-container URL in Docker (e.g. http://api:3001)
    // Falls back to NEXT_PUBLIC_BACKEND_URL for non-Docker deployments. When only the
    // public API URL is configured, use its origin so browser calls still pass through
    // this same-origin rewrite and retain the app's HttpOnly authentication cookies.
    const publicApiTarget = (() => {
      const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!configuredApiUrl || !/^https?:\/\//i.test(configuredApiUrl)) {
        return undefined;
      }

      try {
        return new URL(configuredApiUrl).origin;
      } catch {
        return undefined;
      }
    })();
    const apiTarget =
      process.env.INTERNAL_API_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      publicApiTarget ||
      "http://localhost:3001";

    return [
      {
        source: "/api/:path*",
        destination: `${apiTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
