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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
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
