"use client";

import Link from "@/components/navigation/AppLink";
import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();

  const isLinkActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <footer className="border-t border-border/70 bg-card/60 pt-12 pb-10 text-foreground">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Footer Navigation Columns */}
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-3 pb-10 border-b border-border/60">
          {/* Brand Column */}
          <div className="lg:col-span-2 space-y-4">
            <Link href="/" className="inline-block text-2xl font-bold tracking-tight text-foreground group">
              NUTS<span className="text-primary transition-transform group-hover:scale-125 inline-block">.</span>
            </Link>
            <p className="max-w-sm text-sm text-muted-foreground leading-relaxed">
              The premier multi-vendor commerce marketplace in Nigeria. Discover unique handcrafted goods, fashion, art, and lifestyle products directly from verified independent vendors.
            </p>
          </div>

          {/* Vendor Hub Links */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/90">
              Vendor Hub
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href="/auth/vendor/register"
                  className={`transition-colors duration-150 ${
                    isLinkActive("/auth/vendor/register")
                      ? "font-semibold text-primary"
                      : "text-muted-foreground hover:text-primary"
                  }`}
                >
                  Become a Vendor
                </Link>
              </li>
              <li>
                <Link
                  href="/auth/vendor/login"
                  className={`transition-colors duration-150 ${
                    isLinkActive("/auth/vendor/login")
                      ? "font-semibold text-primary"
                      : "text-muted-foreground hover:text-primary"
                  }`}
                >
                  Vendor Login
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar: Copyright & Policies */}
        <div className="mt-8 flex flex-col items-center justify-between gap-4 text-xs text-muted-foreground sm:flex-row">
          <p>© 2026 NUTS Marketplace. All rights reserved.</p>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-end">
            <Link href="/" className="hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            <Link href="/" className="hover:text-foreground transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
