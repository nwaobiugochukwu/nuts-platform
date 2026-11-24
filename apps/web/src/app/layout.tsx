import { cookies, headers } from "next/headers";
import { Inter } from "next/font/google";
import { PaystackScript } from "@/components/domain/payments/PaystackScript";
import { RouteProgressBar } from "@/components/feedback/RouteProgressBar";
import { Provider } from "@/provider";
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// The browser bar colour follows the theme the user CHOSE (saved in a cookie), not just the
// phone's OS setting. With no saved choice ("system") the OS-based pair is kept.
export async function generateViewport(): Promise<Viewport> {
  let saved: string | undefined;
  try {
    saved = (await cookies()).get("nuts_theme")?.value;
  } catch {
    // Static prerender: fall back to the OS-based pair.
  }
  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
    viewportFit: "cover",
    themeColor:
      saved === "dark"
        ? "#09090b"
        : saved === "light"
          ? "#ffffff"
          : [
              { media: "(prefers-color-scheme: light)", color: "#ffffff" },
              { media: "(prefers-color-scheme: dark)", color: "#09090b" },
            ],
  };
}

export const metadata: Metadata = {
  title: "NUTS",
  description: "Discover premium products from top vendors",
  other: {
    "google-adsense-account": "ca-pub-7056273601633505",
  },
};

const THEME_INITIALIZER_SCRIPT = `
(function() {
  try {
    if (typeof window !== 'undefined' && window.performance && typeof window.performance.measure === 'function') {
      var _origMeasure = window.performance.measure.bind(window.performance);
      window.performance.measure = function(name, startOrMeasureOptions, endMark) {
        try {
          return _origMeasure(name, startOrMeasureOptions, endMark);
        } catch (e) {
          // Suppress Next.js Turbopack internal User Timing negative timestamp bugs in dev
          return undefined;
        }
      };
    }
  } catch (e) {}
  try {
    var d = document.documentElement;
    var stored = localStorage.getItem('nuts_theme');
    var isDark = false;
    if (stored === 'dark') {
      isDark = true;
    } else if (stored === 'light') {
      isDark = false;
    } else {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    if (isDark) {
      d.classList.add('dark');
      d.classList.remove('light');
      d.style.colorScheme = 'dark';
    } else {
      d.classList.remove('dark');
      d.classList.add('light');
      d.style.colorScheme = 'light';
    }
    var bar = isDark ? '#09090b' : '#ffffff';
    var metas = document.head.querySelectorAll('meta[name="theme-color"]');
    for (var i = metas.length - 1; i > 0; i--) metas[i].remove();
    var meta = metas[0];
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.appendChild(meta); }
    meta.removeAttribute('media');
    meta.setAttribute('content', bar);
    if (stored && document.cookie.indexOf('nuts_theme=' + encodeURIComponent(stored)) === -1) {
      document.cookie = 'nuts_theme=' + encodeURIComponent(stored) + '; path=/; max-age=31536000; SameSite=Lax';
    }
  } catch (e) {}
})();
`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  let initialThemeClass = "";
  let initialColorScheme: "dark" | "light" | undefined = undefined;

  try {
    const cookieStore = await cookies();
    const themeCookie = cookieStore.get("nuts_theme")?.value;
    if (themeCookie === "dark") {
      initialThemeClass = "dark";
      initialColorScheme = "dark";
    } else if (themeCookie === "light") {
      initialThemeClass = "light";
      initialColorScheme = "light";
    }
  } catch {
    // Graceful fallback during static pre-rendering
  }

  return (
    <html
      lang="en"
      className={`${inter.variable} ${initialThemeClass}`.trim()}
      style={initialColorScheme ? { colorScheme: initialColorScheme } : undefined}
      suppressHydrationWarning
    >
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <script
          id="theme-head-initializer"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: THEME_INITIALIZER_SCRIPT,
          }}
        />
      </head>
      {/*
       * suppressHydrationWarning on <body> silences false-positive hydration
       * mismatches caused by browser extensions (Grammarly, 1Password, etc.)
       * that inject their own data-* attributes into the <body> element before
       * React has a chance to hydrate. This is a React-blessed pattern for
       * exactly this scenario — it only suppresses warnings one level deep and
       * does NOT affect child component hydration checks.
       */}
      <body
        className="font-sans antialiased text-foreground bg-background"
        suppressHydrationWarning
      >
        <script
          id="theme-body-initializer"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: THEME_INITIALIZER_SCRIPT,
          }}
        />
        <Suspense fallback={null}>
          <RouteProgressBar />
        </Suspense>
        <Suspense fallback={null}>
          <PaystackScript />
        </Suspense>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
