import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ThemeController } from "@/components/theme/ThemeController";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

// Fonts come from the self-hosted `geist` package (the font files ship inside it), not
// next/font/google — so the build never fetches from Google's CDN, which was failing on the
// deploy host. The package exposes `--font-geist-sans` / `--font-geist-mono`; globals.css aliases
// `--font-geist` → `--font-geist-sans` so the existing inline styles keep resolving.

// Public site origin for absolute metadata URLs; localhost fallback in development.
// `||` (not `??`) so an unset NEXT_PUBLIC_SITE_URL — which the bundler can inline as an empty
// string rather than undefined — still falls back instead of producing `new URL('')`.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const title = "Pexa — Your payment agent, wherever you work";
const description =
  "Send, request and manage stablecoin payments through a single intelligent payment layer connected to the tools you already use. Built on Celo.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Pexa",
  title,
  description,
  // The marketing page is meant to be indexed; the /styleguide route opts out on its own.
  robots: { index: true, follow: true },
  // The standalone Pexa P mark, as an SVG favicon (crisp, theme-agnostic).
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon-v2.png", sizes: "180x180", type: "image/png" }],
  },
  // Opens full-screen like an app once it is on the home screen (iPhone).
  appleWebApp: { capable: true, title: "Pexa", statusBarStyle: "default" },
  openGraph: {
    type: "website",
    siteName: "Pexa",
    title,
    description,
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw under the notch / home bar; the app pads for it with env(safe-area-inset-*).
  viewportFit: "cover",
  // Matches the off-white page ground (§94) so mobile browser chrome blends in (ThemeController darkens it in dark mode).
  themeColor: "#F6F7F9",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before paint by the inline script (and kept current by ThemeController), so React must not
    // treat the extra attribute as a hydration mismatch.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeController />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
