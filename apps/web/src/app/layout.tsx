import { cookies } from "next/headers";
import { PaystackScript } from "@/components/paystack-script";
import { RouteProgressBar } from "@/components/feedback/RouteProgressBar";
import { Provider } from "@/provider";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

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
      className={initialThemeClass}
      style={initialColorScheme ? { colorScheme: initialColorScheme } : undefined}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <script
          id="theme-head-initializer"
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
        className={`${inter.variable} font-sans antialiased text-foreground bg-background`}
        suppressHydrationWarning
      >
        <script
          id="theme-body-initializer"
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
