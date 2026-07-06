import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./theme.css";
import MobileTabBar from "@/components/nav/MobileTabBar";
import OfflineReady from "@/components/OfflineReady";
import { AuthProvider } from "@/components/auth/AuthProvider";

// Type trio for the field-guide identity (see docs/DESIGN_SYSTEM.md):
//  - display: Fraunces — a characterful, slightly inky serif (soft ink-trap
//    details at "opsz" 72+) for brand + headlines. Distinct from the generic
//    Playfair/cream-and-terracotta look; reads like hand-set guidebook type.
//  - body: Inter — already the app's body face; formalised as a variable so
//    every surface (not just `body`) can opt in without hardcoding a family.
//  - data: JetBrains Mono — tabular, ticket/till-stamp character for prices,
//    the price stamp, and other numeric readouts. Deliberately NOT the body
//    face, so a price reads as "stamped", not just bolded text.
// All three are wired as CSS custom properties on <html> so globals.css/
// theme.css and every component that already reads var(--serif) etc. pick
// them up with zero per-component edits.
const displaySerif = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  // Variable font: weight must stay "variable" for the opsz/SOFT axes to load.
  // Weight is set per-rule in CSS (headings ~600) — the variable face carries the
  // full 100–900 range, and font-optical-sizing:auto drives opsz from font-size.
  axes: ["opsz", "SOFT"],
  weight: "variable",
  style: ["normal", "italic"],
  // adjustFontFallback defaults ON: next/font emits a metric-matched
  // "Fraunces Fallback" @font-face (size-adjust + ascent/descent/line-gap
  // overrides) so the Palatino→Fraunces swap does not reflow. Kept explicit.
  adjustFontFallback: true,
});

const bodySans = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const dataMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-data",
  display: "swap",
  // 400 added so un-weighted var(--font-data) consumers (globals.css .font-data,
  // venue price story) render a real regular weight rather than a synthesised
  // (faux-bold-adjacent) fallback. 500/700 remain for stamped/emphasis numerals.
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pubmaxx.vercel.app"),
  title: {
    default: "PUBMAXXING — Every pint has a story",
    template: "%s | PUBMAXXING",
  },
  description:
    "Every pint has a story. PUBMAXXING is a price-aware, story-led London pub-crawl planner — real pint prices, heritage pubs, and community Pint Drops.",
  openGraph: {
    title: "PUBMAXXING — Every pint has a story",
    description:
      "Cheap pints, chaotic nights, and the crawl stories worth passing down. Plan London pub crawls by price, story, and community Pint Drops.",
    url: "https://pubmaxx.vercel.app",
    siteName: "PUBMAXXING",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "PUBMAXXING — London pub crawl planner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PUBMAXXING — Every pint has a story",
    description:
      "Cheap pints, chaotic nights, and the crawl stories worth passing down. Plan London pub crawls by price, story, and community Pint Drops.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${displaySerif.variable} ${bodySans.variable} ${dataMono.variable}`}
    >
      <head>
        {/* Set theme before paint to avoid a flash of the wrong theme. Served
            as a static file (public/theme-init.js) rather than inline so it is
            covered by CSP `script-src 'self'` with no per-build hash. It is a
            render-blocking classic script in <head> (NO async/defer on purpose)
            so it runs before first paint, preserving the no-flash guarantee.
            That synchronous load is the whole point here, so the no-sync-scripts
            lint (which exists to prevent render-blocking body scripts) is opted
            out for this one intentional case. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" />
      </head>
      <body>
        {/* AuthProvider is additive: it establishes identity for signed-in users
            but never gates a route — anonymous browsing stays fully public. The
            session loads async client-side, so children render immediately. */}
        <AuthProvider>
          {children}
          {/* App-wide bottom tab bar — visible only on ≤640px (see mobileNav.css);
              display:none on desktop so the existing navs are untouched. */}
          <MobileTabBar />
          {/* Silent offline SW registration (issue #32) — renders nothing,
              production-only, registers after load. */}
          <OfflineReady />
        </AuthProvider>
      </body>
    </html>
  );
}
