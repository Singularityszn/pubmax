import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import "./theme.css";
import MobileTabBar from "@/components/nav/MobileTabBar";
import OfflineReady from "@/components/OfflineReady";
import FirstRunTour from "@/components/onboarding/FirstRunTour";
import { AuthProvider } from "@/components/auth/AuthProvider";

// Type trio for the PUBMAXXING identity (see docs/DESIGN_SYSTEM.md):
//  - display: Space Grotesk — a Gen-Z-native geometric grotesque with a very
//    large x-height, so capitals and lowercase sit close in size (little
//    caps-contrast) and headlines read confident, current, and calm rather
//    than shouty. This supersedes the earlier Fraunces "field-guide serif"
//    thesis: the brand is now a modern display sans, not hand-set serif.
//  - body: Inter — already the app's body face; formalised as a variable so
//    every surface (not just `body`) can opt in without hardcoding a family.
//  - data: JetBrains Mono — tabular, ticket/till-stamp character for prices,
//    the price stamp, and other numeric readouts. Deliberately NOT the body
//    face, so a price reads as "stamped", not just bolded text.
// All three are wired as CSS custom properties on <html> so globals.css/
// theme.css and every component that already reads var(--serif) etc. pick
// them up with zero per-component edits.
const displayFace = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  // Variable weight axis (300–700). Weight is set per-rule in CSS (headings
  // 500–700 per the display-weight discipline); the variable face carries the
  // full range, so no reflow between weights.
  weight: "variable",
  // adjustFontFallback defaults ON: next/font emits a metric-matched
  // "Space Grotesk Fallback" @font-face (size-adjust + ascent/descent/line-gap
  // overrides) so the fallback→webfont swap does not reflow. Kept explicit.
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
  metadataBase: new URL("https://pubmaxxing.com"),
  title: {
    default: "PUBMAXXING — Every pint has a story",
    template: "%s | PUBMAXXING",
  },
  description:
    "Every pint has a story. PUBMAXXING is a price-aware, story-led London pub-crawl planner — real pint prices, heritage pubs, and community Pint Drops.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PubMax",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "PUBMAXXING — Every pint has a story",
    description:
      "Cheap pints, chaotic nights, and the crawl stories worth passing down. Plan London pub crawls by price, story, and community Pint Drops.",
    url: "https://pubmaxxing.com",
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
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    // iOS Safari requires a raster apple-touch-icon (SVG is ignored).
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

// theme_color matches --ink-deep (light tokens); viewport-fit=cover for
// standalone PWA / notched phones.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#16122a" },
    { media: "(prefers-color-scheme: dark)", color: "#090806" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
      className={`${displayFace.variable} ${bodySans.variable} ${dataMono.variable}`}
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
        {/* IDEAS B5 — Speculation Rules: declaratively prerender the LIKELY next
            page while the user browses the explore-London loop, so tapping
            through borough/discover surfaces is instant. Conservative by design:
              - eagerness "moderate" (hover/pointerdown intent) for prerender, so
                the browser only spends bandwidth/compute on links the user is
                actually about to click — avoids the over-prerendering + early
                analytics/side-effect risk flagged in B5.
              - candidates are href-prefix scoped to same-origin, GET-only,
                static-ish surfaces: /borough/* (borough chapters), /crawls,
                /discover. EXPLICITLY excludes /map (heavy WebGL — a prerendered
                MapLibre canvas is wasteful and janky) and every route with side
                effects (auth, composer, /api).
            This is a JSON data block, NOT executable JavaScript: the browser
            parses it as speculation rules, never runs it. CSP: it is governed by
            script-src, and our policy already allows 'unsafe-inline' there (see
            next.config.mjs), so no CSP change is needed. Unsupported browsers
            ignore an unknown script type entirely → pure progressive
            enhancement, zero behaviour change where it isn't understood. */}
        <script
          type="speculationrules"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              prerender: [
                {
                  source: "list",
                  /* Wave I3: include /feed (Stories) — light RSC, no WebGL. */
                  urls: ["/crawls", "/discover", "/feed"],
                  eagerness: "moderate",
                },
                {
                  where: {
                    href_matches: "/borough/*",
                  },
                  eagerness: "moderate",
                },
              ],
            }),
          }}
        />
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
          {/* One-time first-run onboarding tour — renders nothing on the
              server / for returning users (gated on hasSeenTour). */}
          <FirstRunTour />
          {/* Silent offline SW registration (issue #32) — renders nothing,
              production-only, registers after load. */}
          <OfflineReady />
        </AuthProvider>
        {/* Vercel Web Analytics (R3) — cookie-less pageview + custom-event
            tracking (see lib/analytics.ts for the typed trackEvent rail).
            Outside AuthProvider on purpose: it's app infra, not identity. */}
        <Analytics />
      </body>
    </html>
  );
}
