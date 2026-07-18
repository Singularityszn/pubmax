import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import ConsentAwareVercelAnalytics from "@/components/ConsentAwareVercelAnalytics";
import "./globals.css";
import "./theme.css";
import MobileTabBar from "@/components/nav/MobileTabBar";
import NightModeCard from "@/components/night/NightModeCard";
import OfflineReady from "@/components/OfflineReady";
import FirstRunTour from "@/components/onboarding/FirstRunTour";
import A2HSInstallPrompt from "@/components/pwa/A2HSInstallPrompt";
import NativePushPrompt from "@/components/native/NativePushPrompt";
import { AuthProvider } from "@/components/auth/AuthProvider";
import CommandPaletteProvider from "@/components/command/CommandPaletteProvider";
import PubPalSummon from "@/components/pubpal/PubPalSummon";
import PerformanceVitals from "@/components/PerformanceVitals";
import JsonLd from "@/components/seo/JsonLd";
import DailyActivityPulse from "@/components/DailyActivityPulse";
import A2HSTracking from "@/components/A2HSTracking";

// Site-wide structured data (Wave S1.3). WebSite + Organization only — the
// identity graph Google reads for the brand panel and AI engines read to know
// what pubmaxxing.com IS. No SearchAction/potentialAction: the only on-site
// search is the client-rendered WebGL map (/map?q=), which is not a crawlable
// results page, so advertising a sitelinks search box would be schema for
// something we can't prove (PRD non-negotiable). logo is an absolute URL to a
// shipped icon asset (public/icon-512.png).
const SITE_JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": "https://pubmaxxing.com/#website",
    name: "PUBMAXXING",
    alternateName: "PUBMAXX",
    url: "https://pubmaxxing.com",
    description:
      "A price-aware, provenance-first London pub map and crawl planner. Real observed pint prices and cited historic pubs.",
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": "https://pubmaxxing.com/#organization",
    name: "PUBMAXXING",
    url: "https://pubmaxxing.com",
    logo: "https://pubmaxxing.com/icon-512.png",
  },
];

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
    default: "PUBMAXX: Make tonight worth remembering",
    template: "%s | PUBMAXX",
  },
  description:
    "PUBMAXX is a price-aware nightlife map for real pint prices, live plans, side quests, and stories worth remembering.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PUBMAXX",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "PUBMAXX: Make tonight worth remembering",
    description:
      "Real prices, live plans and unexpected places. Built for better nights with your people.",
    url: "https://pubmaxxing.com",
    siteName: "PUBMAXX",
    type: "website",
    images: [
      {
        url: "/og.png?v=20260715-coral",
        width: 1200,
        height: 630,
        alt: "PUBMAXX nightlife map and planner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PUBMAXX: Make tonight worth remembering",
    description:
      "Real prices, live plans and unexpected places. Built for better nights with your people.",
    images: ["/og.png?v=20260715-coral"],
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request CSP nonce (set by proxy.ts). Stamped onto our inline
  // speculation-rules block below — inline speculation rules are gated by
  // script-src, so under the nonce policy they need the nonce to be honoured.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${displayFace.variable} ${bodySans.variable} ${dataMono.variable}`}
    >
      <head>
        {/* Perf (mobile map budget): the WebGL basemap streams its vector tiles,
            glyphs and sprite from tiles.openfreemap.org (see
            components/map/canvas/tokens.ts). That cross-origin handshake
            (DNS + TCP + TLS ≈ 1 RTT each on 4G) otherwise doesn't begin until
            MapLibre boots AFTER the ~4 MB map chunk parses — serialising the two
            slowest things on the critical path. Opening the connection during
            initial HTML parse lets the tile fetch fire the instant the style
            loads, shaving that round-trip off first-tile-paint. Cheap and
            harmless on non-map routes (browsers drop an unused preconnect after
            ~10s); dns-prefetch is the fallback for engines that ignore
            preconnect. crossOrigin is required — tile/glyph requests are CORS. */}
        <link
          rel="preconnect"
          href="https://tiles.openfreemap.org"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://tiles.openfreemap.org" />
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
            parses it as speculation rules, never runs it. CSP: it is still
            governed by script-src, so under the per-request nonce policy
            (proxy.ts) it carries the nonce below; without it the browser would
            drop the rules. Unsupported browsers ignore an unknown script type
            entirely → pure progressive enhancement, zero behaviour change where
            it isn't understood. */}
        <script
          type="speculationrules"
          nonce={nonce}
          suppressHydrationWarning
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
        {/* Site-wide JSON-LD (WebSite + Organization). Carries the nonce like
            every other inline script under the nonce CSP (proxy.ts). */}
        <JsonLd data={SITE_JSON_LD} nonce={nonce} />
      </head>
      <body>
        {/* AuthProvider is additive: it establishes identity for signed-in users
            but never gates a route — anonymous browsing stays fully public. The
            session loads async client-side, so children render immediately. */}
        <AuthProvider>
          {/* Global ⌘K / Ctrl+K command palette (feature N1). A client provider
              mounted at the root so the shortcut works from any page; it owns the
              open/close state and renders the dialog only while open. Wraps
              children so SiteNav's ⌘K affordance can read its context. */}
          <CommandPaletteProvider>
            {children}
            {/* App-wide bottom tab bar — visible only on ≤640px (see mobileNav.css);
                display:none on desktop so the existing navs are untouched. */}
            <MobileTabBar />
            {/* Night Mode (Wave E2) — the "during the night" surface. A
                persistent bottom card that appears across every screen while a
                plan is on tonight; renders nothing otherwise. */}
          <NightModeCard />
          <PubPalSummon />
            {/* One-time first-run onboarding tour — renders nothing on the
                server / for returning users (gated on hasSeenTour). */}
            <FirstRunTour />
            {/* Add-to-Home-Screen install prompt (Cycle-4 Wave-C) — renders
                nothing until PROVEN VALUE (second visit day or first completed
                night) and only when the shared prompt budget is free, so it
                never stacks on the first-run tour. */}
            <A2HSInstallPrompt />
            {/* Contextual native push pre-permission explainer (Capacitor
                shell only) — renders nothing on web/SSR; budget-gated and
                identity-first per docs/PROMPT_ORCHESTRATION.md. */}
            <NativePushPrompt />
            {/* Silent offline SW registration (issue #32) — renders nothing,
                production-only, registers after load. */}
            <OfflineReady />
            <PerformanceVitals />
            {/* Metrics funnel (Wave M) — consent-gated, render-nothing
                signals: daily return-rate pulse and the A2HS install funnel. */}
            <DailyActivityPulse />
            <A2HSTracking />
          </CommandPaletteProvider>
        </AuthProvider>
        {/* Vercel Web Analytics (R3) — consent-gated pageviews only. Product
            events use the separately allow-listed rail in lib/analytics.ts.
            Outside AuthProvider on purpose: it's app infra, not identity. */}
        <ConsentAwareVercelAnalytics />
      </body>
    </html>
  );
}
