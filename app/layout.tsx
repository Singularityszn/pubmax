import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Space_Grotesk, Inter } from "next/font/google";
import localFont from "next/font/local";
import ConsentAwareVercelAnalytics from "@/components/ConsentAwareVercelAnalytics";
import ConsentAwareVercelSpeedInsights from "@/components/ConsentAwareVercelSpeedInsights";
import "./globals.css";
import "./theme.css";
import CreateFab from "@/components/nav/CreateFab";
import MobileTabBar, {
  MobileTabBarClearanceFallback,
} from "@/components/nav/MobileTabBar";
import DeferredShellExtras from "@/components/DeferredShellExtras";
import ClientErrorReporter from "@/components/ClientErrorReporter";
import OfflineReady from "@/components/OfflineReady";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { clerkAppearance } from "@/lib/clerkAppearance";
import {
  isClerkConfigured,
  isClerkMiddlewareConfigured,
} from "@/lib/clerkIdentity";
import CommandPaletteProvider from "@/components/command/CommandPaletteProvider";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";
import { siteJsonLd } from "@/lib/siteJsonLd";
import PerformanceVitals from "@/components/PerformanceVitals";
import JsonLd from "@/components/seo/JsonLd";
import { serializeInlineScriptJson } from "@/lib/inlineScriptJson";
import DailyActivityPulse from "@/components/DailyActivityPulse";
import EntryBootStamp from "@/components/native/EntryBootStamp";
import A2HSTracking from "@/components/A2HSTracking";
import AnalyticsConsentPrompt from "@/components/AnalyticsConsentPrompt";
import PosthogPageviews from "@/components/PosthogPageviews";
import SkipLink from "@/components/a11y/SkipLink";
import SplashAperture from "@/components/splash/SplashAperture";
import DeploymentSkewRecovery from "@/components/DeploymentSkewRecovery";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";
import { SocialFriendsLaunchProvider } from "@/lib/useSocialFriendsLaunch";
import OptionalClerkProvider from "@/components/auth/OptionalClerkProvider";

// Clerk is optional. Keep its provider, revision bridge, and client auth graph
// out of every keyless route, which is the normal map build, by loading one
// client boundary only when both Clerk keys open its provider branch below.

// Site-wide structured data (Wave S1.3). WebSite + Organization graph lives in
// lib/siteJsonLd.ts so tests and the layout share one emitter.

// Speculation rules for the prerender candidates documented at the <script>
// below. Hoisted to module scope so the block is a rendered constant rather
// than an object literal built inside JSX, and so the emitted body goes through
// the one hardened inline-script serializer with every other <script> we write.
const SPECULATION_RULES = {
  prerender: [
    {
      source: "list",
      /* Social owns the chronological and public discovery surfaces. */
      urls: ["/crawls", "/social", "/social?tab=discover"],
      eagerness: "moderate",
    },
    {
      where: {
        href_matches: "/borough/*",
      },
      eagerness: "moderate",
    },
  ],
};

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

// Vendored, not fetched. next/font/google rewrites each face's file URL into a
// query that Turbopack must parse as exactly one entry, and on 4 Oct 2026 this
// face failed that parse on hosted CI builds ("next/font/google queries have
// exactly one entry"), so a build could die on Google's answer. The file is the
// latin one Google served for both weights (v24), so the bytes do not change.
const dataMono = localFont({
  // Google served one variable file for 400 and for 700 and declared two
  // faces on it. Two faces again, not one 400-700 range: a range would draw
  // the 550 shorthands at 550, while a 700 face clamps them to 700 as before.
  src: [
    { path: "./_fonts/JetBrainsMono-latin-wght-400-700.woff2", weight: "400", style: "normal" },
    { path: "./_fonts/JetBrainsMono-latin-wght-400-700.woff2", weight: "700", style: "normal" },
  ],
  // next/font/local names its faces after this const ("dataMono") unless told
  // otherwise, but the :root token in app/globals.css asks for "JetBrains Mono",
  // the family next/font/google declared. Unnamed, no face matched and every
  // numeral painted in the system monospace.
  declarations: [{ prop: "font-family", value: "JetBrains Mono" }],
  variable: "--font-data",
  display: "swap",
  // NOT preloaded, unlike the display and body faces. next/font preloads every
  // declared face from the document head, so this one cost a request and its
  // bytes on the critical path of all 35 budgeted routes while no route paints
  // its largest element in it: it is the price stamp and the numerals, and the
  // map draws its own glyphs. Measured on the Avrea runner, /pubs asked 69
  // requests against a ceiling of 68 and /map painted at 952 ms against 900,
  // both as medians of five samples rather than jitter. The face still loads
  // the moment something uses it, and display: swap plus the metric-matched
  // fallback above keep the swap from moving the page.
  preload: false,
  // The metric-matched fallback is the exact face next/font/google generated
  // for this family (app/globals.css, "JetBrains Mono Fallback"). Recomputing
  // it from the vendored file moved size-adjust from 134.59% to 131.49%, which
  // would shift every numeral that paints before the swap.
  adjustFontFallback: false,
  fallback: ["JetBrains Mono Fallback"],
  // 400 for un-weighted var(--font-data) consumers (globals.css .font-data, the
  // venue price story), which would otherwise render a synthesised
  // faux-bold-adjacent fallback, and 700 for the stamped and emphasis numerals.
  //
  // 500 is gone because nothing can reach it. CSS picks the nearest available
  // weight, and for a target ABOVE 500 it searches upward first, so every
  // stamped rule in the tree - the 550 shorthands on the landing, the legal
  // pages and the drop strip, and the 600/640/650 ones in Pub Pal chat - lands
  // on 700 already. Only an exact 500, or a target in (400, 500], could have
  // used it, and no shipped rule asks for either. __tests__/fontWeights.test.ts
  // is what keeps that true.
});

// No party accent (Bungee) webfont is loaded on any route: the vibe chips were
// its last consumer and left the face on 2026-08-18, so the party-accent token
// is gone from the app and no route pays for a display font nothing draws.
// Share cards still stamp Bungee, from the vendored TTF satori reads
// (lib/ogBrand.tsx), which no browser downloads.
// __tests__/fontPartyContainment.test.ts keeps the token out of shipped code.

export const metadata: Metadata = {
  // Single-owner production origin (lib/siteUrlConfig.mjs). Relative
  // alternates.canonical on every indexable page resolve here, so a preview
  // host cannot advertise itself as the product URL.
  metadataBase: new URL(PRODUCTION_SITE_ORIGIN),
  // Large image previews in search results; without this Google caps result
  // thumbnails at the small default and often shows none at all.
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
    },
  },
  title: {
    default: "PUBMAXX: listed pint prices on an interactive map",
    template: "%s | PUBMAXX",
  },
  description:
    "PubMaxxing is a price-aware London pub map: listed pint prices, what's on tonight, and crawl plans.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // The iOS half of the manifest's `short_name`: this is the label under the
    // Home Screen icon, so it must read the same as the installed name Android
    // takes from public/manifest.webmanifest. The document TITLES below are a
    // separate question and stay as they are.
    title: "PUBMAXXING",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "PUBMAXX: listed pint prices on an interactive map",
    description:
      "Listed pint prices on an interactive map. Plan a crawl with your mates.",
    url: PRODUCTION_SITE_ORIGIN,
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
    title: "PUBMAXX: listed pint prices on an interactive map",
    description:
      "Listed pint prices on an interactive map. Plan a crawl with your mates.",
    images: ["/og.png?v=20260715-coral"],
  },
  icons: {
    // Classic /favicon.ico fallback: Google's favicon crawler and older
    // clients request it directly; its 404 was why search kept a stale icon.
    shortcut: "/favicon.ico?v=2",
    // The linked icons live at *-x paths (owner ruling 2026-07-22: the old
    // mark must never appear anywhere). Browsers key their favicon cache by
    // URL and many ignore query-string busts for icons, so a NEW PATH is the
    // only reliable way to force every returning visitor off the cached old
    // mark without a manual cache clear. The conventional un-suffixed files
    // stay in public/ (byte-identical) for crawlers and hardcoded consumers.
    icon: [
      { url: "/favicon.ico?v=2", type: "image/x-icon", sizes: "48x48" },
      { url: "/favicon-x.svg?v=2", type: "image/svg+xml", sizes: "any" },
      { url: "/icon-x-192.png?v=2", type: "image/png", sizes: "192x192" },
      { url: "/icon-x-512.png?v=2", type: "image/png", sizes: "512x512" },
      // The one dark-icon selector the platforms actually honour today: a
      // `media` query on a favicon link, which Chrome and Firefox resolve for
      // the tab. The web app manifest has NO dark-icon field (its `icons`
      // members are src/sizes/type/purpose and nothing else), so a dark PNG
      // listed there would just be a second same-size candidate the UA could
      // pick in a LIGHT context. It stays out of the manifest for that reason.
      // Declared last so a UA that resolves media by document order lands here.
      {
        url: "/favicon-dark.svg?v=2",
        type: "image/svg+xml",
        sizes: "any",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    // iOS Safari requires a raster apple-touch-icon (SVG is ignored) and takes
    // no `media`: whatever this URL holds is the Home Screen icon in every
    // appearance. It is the LIGHT tile. See docs/BRAND_MARK.md "What iOS
    // honours" for what the Tinted Home Screen appearance then does to it.
    apple: [{ url: "/apple-touch-icon-v2.png", type: "image/png", sizes: "180x180" }],
  },
};

// theme_color matches --ink-deep (light tokens); viewport-fit=cover for
// standalone PWA / notched phones.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b0b0d" },
    { media: "(prefers-color-scheme: dark)", color: "#060607" },
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
  // Server-only two-key check. Client components receive only this boolean,
  // never CLERK_SECRET_KEY or a value derived from its contents.
  const clerkIntegrationConfigured = isClerkMiddlewareConfigured();
  const socialFriendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");
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
        {/* The pre-paint decisions, in one render-blocking file: the native
            shell's entry route first, then the theme and landing splash, so
            neither the shell nor the page paints something it is about to
            replace. One file
            because one request - a second pre-paint script cost every web
            route a fetch for a decision only the shell uses. Served
            as a static file (public/theme-init.js) rather than inline so it is
            covered by CSP `script-src 'self'` with no per-build hash. It is a
            render-blocking classic script in <head> (NO async/defer on purpose)
            so it runs before first paint, preserving the no-flash guarantee.
            That synchronous load is the whole point here, so the no-sync-scripts
            lint (which exists to prevent render-blocking body scripts) is opted
            out for this one intentional case. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js?v=splash-1" />
        {/* IDEAS B5 — Speculation Rules: declaratively prerender the LIKELY next
            page while the user browses the explore-London loop, so tapping
            through borough/Social surfaces is instant. Conservative by design:
              - eagerness "moderate" (hover/pointerdown intent) for prerender, so
                the browser only spends bandwidth/compute on links the user is
                actually about to click — avoids the over-prerendering + early
                analytics/side-effect risk flagged in B5.
              - candidates are href-prefix scoped to same-origin, GET-only,
                static-ish surfaces: /borough/* (borough chapters), /crawls,
                /social. EXPLICITLY excludes /map (heavy WebGL; a prerendered
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
            __html: serializeInlineScriptJson(SPECULATION_RULES),
          }}
        />
        {/* Site-wide JSON-LD (WebSite + Organization). Carries the nonce like
            every other inline script under the nonce CSP (proxy.ts). */}
        <JsonLd data={siteJsonLd} nonce={nonce} />
      </head>
      <body data-social-friends-launch={socialFriendsLaunchEnabled ? "1" : "0"}>
        {/* The nav, the phone tab bar and the command palette all name Social
            from this one server-known answer, so the served HTML carries the
            right label rather than correcting it after hydration. */}
        <SocialFriendsLaunchProvider value={socialFriendsLaunchEnabled}>
        <SplashAperture />
        <SkipLink />
        {/* ClerkProvider is additive beside AuthProvider and sits OUTSIDE it.
            Both identity systems run side by side; Clerk gates no route.

            CRITICAL: only mount when a real publishable key is configured.
            @clerk/nextjs otherwise enters "keyless" development mode and can
            embed a temporary secretKey in the RSC/HTML payload (verified on
            /login and /map with no Clerk env). That must never ship. Half-
            configured deployments (publishable without secret) still hide
            product Clerk controls via clerkIntegrationConfigured below, and
            proxy.ts refuses clerkMiddleware without both keys.

            Placement: inside <body>, never wrapping <html>. No `dynamic`
            prop (would call auth() and break prefetch skips in proxy.ts).
            appearance re-skins Clerk chrome in PUBMAXX tokens. */}
        {isClerkConfigured() ? (
          <OptionalClerkProvider
            appearance={clerkAppearance}
            clerkIntegrationConfigured={clerkIntegrationConfigured}
          >
            {/* AuthProvider is additive: it establishes identity for signed-in users
                but never gates a route - anonymous browsing stays fully public. The
                session loads async client-side, so children render immediately. */}
              {/* Global ⌘K / Ctrl+K command palette (feature N1). A client provider
                  mounted at the root so the shortcut works from any page; it owns the
                  open/close state and renders the dialog only while open. Wraps
                  children so SiteNav's ⌘K affordance can read its context. */}
              <CommandPaletteProvider>
                {children}
                {/* App-wide bottom tab bar — mounted on every route and visible only
                    on ≤640px (see mobileNav.css). display:none on desktop leaves the
                    existing navs untouched.
                    Suspense boundary: it reads useSearchParams; under any future
                    prerendered route that read would otherwise bail the whole
                    page out to CSR. Harmless today, required tomorrow. */}
                <Suspense fallback={<MobileTabBarClearanceFallback />}>
                  <MobileTabBar />
                </Suspense>
                <CreateFab />
                {/* Night Mode card, Pub Pal summon, first-run tour, A2HS prompt and
                    native push explainer all render nothing on first paint, so they
                    load lazily after hydration — see DeferredShellExtras. */}
                <DeferredShellExtras />
                {/* Silent offline SW registration (issue #32) — renders nothing,
                    production-only, registers after load. */}
                <OfflineReady />
                <ClientErrorReporter />
                <PerformanceVitals />
                {/* Metrics funnel (Wave M) — consent-gated, render-nothing
                    signals: daily return-rate pulse and the A2HS install funnel. */}
                <DailyActivityPulse />
                <A2HSTracking />
                {/* Deep-link boot stamp: a boot on any non-root path consumes the
                    session's entry decision, so the installed PWA (which cold-starts
                    on the manifest start_url /tonight) can reach the landing page on
                    a wordmark tap instead of bouncing back to /tonight. */}
                <EntryBootStamp />
              </CommandPaletteProvider>
          </OptionalClerkProvider>
        ) : (
          <AuthProvider clerkIntegrationConfigured={clerkIntegrationConfigured}>
            <CommandPaletteProvider>
              {children}
              <Suspense fallback={<MobileTabBarClearanceFallback />}>
                <MobileTabBar />
              </Suspense>
              <CreateFab />
              <DeferredShellExtras />
              <OfflineReady />
              <ClientErrorReporter />
              <PerformanceVitals />
              <DailyActivityPulse />
              <A2HSTracking />
              <EntryBootStamp />
            </CommandPaletteProvider>
          </AuthProvider>
        )}
        </SocialFriendsLaunchProvider>
        {/* Vercel Web Analytics (R3) and Speed Insights — consent-gated
            pageviews and vitals via beforeSend. Product events use the
            separately allow-listed rail in lib/analytics.ts. Outside
            AuthProvider on purpose: it's app infra, not identity. */}
        <ConsentAwareVercelAnalytics />
        <ConsentAwareVercelSpeedInsights />
        <Suspense fallback={null}>
          <PosthogPageviews />
        </Suspense>
        <AnalyticsConsentPrompt />
        <DeploymentSkewRecovery />
      </body>
    </html>
  );
}
