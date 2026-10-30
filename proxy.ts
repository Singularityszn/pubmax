import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest, ProxyConfig } from "next/server";

import { CHOOSE_CITY_PATH, PLACES_PATH } from "@/lib/cityPickerRoute";
import { MAP_LIST_PATH, MAP_LIST_SEARCH_PARAM } from "@/lib/mapListRoute";
import { OUT_PATH, TONIGHT_PATH } from "@/lib/outRoute";
import { clerkCspSources, isClerkMiddlewareConfigured } from "@/lib/clerkIdentity";
import {
  CDN_DOCUMENT_INLINE_SCRIPT_SOURCE,
  buildContentSecurityPolicy,
  devSupabaseConnectOrigin,
} from "@/lib/contentSecurityPolicy.mjs";
import { assertE2ELoginSafe } from "@/lib/e2eReviewAuth";
import { serverEnvRefusalResponse } from "@/lib/serverEnv";
import { supabaseCspOrigins } from "@/lib/supabaseCsp";
import { ONBOARDING_PATH } from "@/lib/firstRunRoute";
import { isPosterLandingSrc, posterNearHref } from "@/lib/posterLanding";
import {
  MAP_DOCUMENT_PATH,
  MAP_DOCUMENT_TWIN_PATH,
  mapRequestNeedsDocumentTwin,
} from "@/lib/mapDocumentTwin";
import { isStaticAssetPath } from "@/lib/staticAssetPrefixes.mjs";

assertE2ELoginSafe();

const CANONICAL_HOST = "pubmaxxing.com";

// THE ONE CSP EXCEPTION, AND ITS WHOLE LIST.
//
// Captain decision, 2026-08-09, answering the open question PR #974 left: the
// per-request nonce rules out static generation, ISR and PPR, so every page
// view was a function invocation with no CDN copy to serve instead. The
// documents named here - and ONLY these - drop the nonce and take
// `script-src 'unsafe-inline'` in exchange for being prerendered and served
// from the Vercel CDN. Every one is public and anonymous: no document carries
// a name, a handle, a session or any other personal figure, and the client
// fetches every personalised thing after load (a cached document that carried
// one would be handed to the next stranger).
//
// The list opened with `/` and `/map`. Captain 2026-09-05 ("Widen") extended
// the same trade to the other logged-out pages, `/tonight`, `/today` and
// `/near`, on the same terms: each page declares `force-static`, reads no
// cookie, no header and no search param in its document, and takes an ISR
// window sized to the clock it reads (a page that composes off the London hour
// is regenerated every few minutes; a page that reads only bundled data takes
// an hour). Scout #1356 found no way to keep a nonce on a cached document, so
// the inline slot is the price, and it is the ONLY thing that differs.
//
// Every other route - identity, social, profile, admin and every API - keeps
// the strict per-request nonce exactly as before. A route that resolves a
// session in its document (`/u/you`, `/messages`, `/admin`) may never join
// this list, whatever it would buy.
//
// WHAT "KEEPS THE NONCE" MEANS, HONESTLY: a CSP governs the DOCUMENT it
// arrived with, and the browser never swaps it mid-session. So the strict
// nonce policy holds when an identity or social route is loaded as a document
// (a hard load: typed, bookmarked, refreshed, opened from another site). A
// reader who lands on one of the CDN documents below and then moves by
// client-side navigation stays under THAT landing document's policy, with
// `'unsafe-inline'` in the script slot, for the rest of the session; the RSC
// payloads of the routes they reach do not bring a policy of their own. This
// is accepted, not fixed here: what keeps that session safe is that none of
// these documents renders personal data or takes user input into markup (the
// block further down that builds `inlineScriptSource` says the same).
//
// This list is a tracked constant so that adding a route to it is a deliberate
// diff a reviewer sees, never a side effect of a refactor.
// `__tests__/clerkProxyCsp.test.ts` pins both halves: these paths carry
// 'unsafe-inline' and no nonce, and the identity/social/admin routes carry a
// fresh nonce and no 'unsafe-inline'. `__tests__/cdnCachedDocuments.test.ts`
// holds every listed path to a page file that declares `force-static`.
//
// Product decision 2026-10-17 widened it to `/plan` and `/pal`, on the same
// terms: neither document reads the session, a cookie, a header or a search
// param, and both fetch everything personal (drafts, the Pal, memories) in the
// browser after load. `/plan/[id]` and `/pal/chat` are other paths and keep
// the nonce.
export const CDN_CACHED_DOCUMENT_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/map",
  "/tonight",
  "/today",
  "/near",
  "/plan",
  "/pal",
]);

// THE SAME TRADE FOR THE PUBLIC SEO DETAIL PAGES (task vercel-f2-seo-cdn,
// 2026-10-15). 445 sitemap URLs sit on these five route shapes, and with
// roughly a dozen human page views a day the crawlers that robots.txt invites
// were paying a full server render on every fetch, uncached (`private,
// no-store`, `x-vercel-cache: MISS`). Each page renders only bundled datasets
// (cited heritage, the price dataset, curated landmarks, the governed drink
// landings): no cookie, no header, no search param, no session and nothing
// personal, so one copy may be handed to every visitor. Same terms as the
// list above: `force-static`, an ISR window, and the inline slot is the ONLY
// thing that differs. A `[segment]` matches exactly one non-empty path
// segment, so `/historic` (it reads search params) and `/borough` stay on the
// nonce, and so does every deeper path such as an `opengraph-image` route.
//
// `/ledger/[id]` joined on 2026-10-17 (option a, captain's call): 2,214
// sitemap URLs. Its document used to resolve a viewer from the `Authorization`
// header for the Family Table, and it read the Pint Drop store. Neither is in
// the document any more: it carries only the pub's bundled facts and curated
// story line, and the logbook, the drop-derived story lines and the Family
// Table come from GET /api/ledger/[id] after load, per request and never
// cached. So no drinker's words sit in a cached copy, and a hidden, withdrawn
// or erased drop leaves the page as soon as the store stops returning it.
//
// `/routes/[slug]` joined on 2026-10-30 (captain's call): the four named crawl
// pages (SEO audit #2126). Each renders the bundled price dataset and nothing
// a drinker wrote, and it throws rather than cache an unreadable dataset.
//
// `__tests__/cdnCachedDocuments.test.ts` holds each pattern to the page file
// at the same path under app/, which must declare `force-static`.
export const CDN_CACHED_DOCUMENT_ROUTES: ReadonlySet<string> = new Set([
  "/historic/[slug]",
  "/borough/[slug]",
  "/landmark/[id]",
  "/drink/[slug]",
  "/area/[slug]/drink/[brand]",
  "/ledger/[id]",
  "/routes/[slug]",
]);

/** True when `pathname` fills `pattern` segment for segment. */
export function matchesDocumentRoute(pattern: string, pathname: string): boolean {
  const want = pattern.split("/");
  const got = pathname.split("/");
  if (want.length !== got.length) return false;
  return want.every((segment, index) =>
    /^\[[a-z]+\]$/.test(segment) ? got[index] !== "" : segment === got[index],
  );
}

function servesCdnCachedDocument(pathname: string): boolean {
  if (CDN_CACHED_DOCUMENT_PATHS.has(pathname)) return true;
  for (const pattern of CDN_CACHED_DOCUMENT_ROUTES) {
    if (matchesDocumentRoute(pattern, pathname)) return true;
  }
  return false;
}

// Preview and development deploys must never be indexed. VERCEL_ENV is the
// authority (preview hostnames change every deployment). Production keeps no
// extra robots header so the crawl invitation in app/robots.ts stands alone.
function applyNonProductionRobotsTag(response: NextResponse): NextResponse {
  if (process.env.VERCEL_ENV !== "production") {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

function normalizeHostname(host: string | null | undefined): string | null {
  const normalizedHost = host?.trim().toLowerCase();
  if (!normalizedHost) return null;
  if (normalizedHost.startsWith("[")) {
    const closingBracket = normalizedHost.indexOf("]");
    return closingBracket === -1
      ? normalizedHost
      : normalizedHost.slice(1, closingBracket);
  }
  return normalizedHost.replace(/:\d+$/, "").replace(/\.$/, "");
}

function requestHostname(request: NextRequest): string {
  return (
    normalizeHostname(request.headers.get("host")) ??
    request.nextUrl.hostname.toLowerCase()
  );
}

function isArtifactPreviewHost(request: NextRequest): boolean {
  const hostname = requestHostname(request);
  return [
    request.headers.get("x-vercel-deployment-url"),
    process.env.VERCEL_BRANCH_URL,
  ].some((artifactHost) => normalizeHostname(artifactHost) === hostname);
}

/** Whether this request asks for an HTML document rather than a data payload. */
function wantsDocument(request: NextRequest): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/**
 * Whether a page on this same origin started this navigation.
 *
 * `Sec-Fetch-Site` is the browser's own word and a page cannot forge it, so
 * when it is sent it decides alone. WKWebView sends it only from iOS 16.4 and
 * the app targets 15.0, so when it is ABSENT a Referer on this same host
 * answers instead. The site sends `strict-origin-when-cross-origin`
 * (next.config.mjs), which keeps the Referer on a same-origin navigation.
 */
function startedOnThisOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin";
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    const refererUrl = new URL(referer);
    return (
      normalizeHostname(refererUrl.host) === requestHostname(request) &&
      refererUrl.protocol === request.nextUrl.protocol
    );
  } catch {
    return false;
  }
}

function servesApiCaller(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** The PostHog relay (`app/ingest/[...path]`): a caller, never a Clerk consumer. */
function servesIngestRelay(pathname: string): boolean {
  return pathname === "/ingest" || pathname.startsWith("/ingest/");
}

// AN API REQUEST IS A CALLER, NOT A READER, SO IT IS NEVER SENT ELSEWHERE.
//
// A 308 tells the client to ask again at another address, and a client that is
// not a browser may simply not do that. Vercel's cron dispatcher is one of
// those: it issues its scheduled GET against the deployment's own *.vercel.app
// host, so the host canonicalisation below answered every job on pubmaxxing.com
// with a 308 and NO handler ran - the social moderation pair every ten minutes
// and freshness-audit, which is the watchdog that would
// otherwise have said so. Nothing alerted because the alarm was among the dead.
//
// Serving those routes on the generated host is safe because their gate is the
// CALLER'S CREDENTIAL rather than the hostname: every app/api/cron/* handler
// calls assertCronRequest (lib/cronAuth.ts), which requires
// `Authorization: Bearer ${CRON_SECRET}` and denies in production when the
// secret is unset. The whole /api tree is exempt rather than /api/cron alone,
// because the same silence would swallow any webhook or callback aimed at a
// deployment URL, and because what the canonicalisation protects is the SEO
// split-brain that a crawlable DOCUMENT mirror creates. A JSON answer is not
// that mirror; page documents still canonicalise exactly as before.
//
// The trailing-slash rule further down is deliberately NOT exempted: with
// `skipTrailingSlashRedirect` in next.config.mjs, `/api/thing/` matches no
// route, so that 308 is what makes the address work rather than what breaks it,
// and it keeps the caller on the host it addressed.
function shouldRedirectVercelHost(request: NextRequest): boolean {
  if (!requestHostname(request).endsWith(".vercel.app")) return false;
  if (servesApiCaller(request.nextUrl.pathname)) return false;
  return !(
    process.env.VERCEL_ENV === "preview" &&
    isArtifactPreviewHost(request)
  );
}

function shouldSkipContentSecurityPolicy(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  const excludedPath =
    servesApiCaller(pathname) ||
    // A static asset under one of the public prefixes. The matcher below
    // already keeps these out of the function on the canonical host; this is
    // the second line, because the `*.vercel.app` matcher claims every path on
    // a preview artifact host and a font file has no more use for a nonce there
    // than in production. See lib/staticAssetPrefixes.mjs for the whole rule.
    isStaticAssetPath(pathname) ||
    pathname === "/_next/static" ||
    pathname.startsWith("/_next/static/") ||
    pathname === "/_next/image" ||
    pathname.startsWith("/_next/image/") ||
    // Webpack-mode `next dev` upgrades `/_next/hmr` to a WebSocket. Running
    // this function in front of that handshake answers ordinary HTTP (CSP
    // headers, no upgrade) and the browser logs ERR_INVALID_HTTP_RESPONSE —
    // measured 2026-09-23: client JS then never hydrates, so /out stays on
    // "Loading listings" and /map stays on "Loading London pubs…" with no
    // /api/out and no PubMap chunk. Keep the upgrade off this path.
    pathname === "/_next/hmr" ||
    pathname.startsWith("/_next/hmr/") ||
    pathname === "/favicon.ico";
  // Only NEXT's router prefetch skips the CSP work: it is an RSC fetch, the
  // payload carries no document for a policy to govern, and minting a nonce
  // for it is wasted work on every link the router warms. `Purpose: prefetch`
  // and `Sec-Purpose: prefetch;prerender` are deliberately NOT read here. They
  // are the BROWSER's words for a DOCUMENT fetched ahead of a navigation (a
  // <link rel=prefetch>, or a speculation-rules prerender from app/layout.tsx
  // of `/social`, `/crawls` or `/borough/*`), and that document is the one the
  // reader is then shown, so it keeps its CSP, Clerk and every redirect and
  // gate above. A request that asks for HTML is a document whatever else it
  // carries, so even the router header cannot strip the policy off one.
  const routerPrefetch =
    request.headers.has("next-router-prefetch") && !wantsDocument(request);
  return excludedPath || routerPrefetch;
}

// Per-request Content-Security-Policy with a fresh nonce.
//
// WHY THIS EXISTS (see the matching block that USED to live in next.config.mjs):
// the CSP was previously served as a static header, which forced
// `script-src 'unsafe-inline'` because Next.js 16's App-Router RSC streaming
// scripts (the per-page `self.__next_f.push(...)` bootstrap + hydration payload)
// are inline, and their content — hence any sha256 hash — differs per page and
// per build, so they can't be statically hashed. The ONLY way to drop
// 'unsafe-inline' from script-src without breaking hydration is a per-request
// nonce applied via this proxy: Next.js reads the nonce from the
// `Content-Security-Policy` REQUEST header (the 'nonce-<value>' pattern) and
// stamps it onto every inline script it emits. Our own inline scripts
// (speculation rules in app/layout.tsx, the copy-link handlers in
// app/p/[id] and app/crawls/[slug]) read the nonce from the `x-nonce` request
// header and carry it explicitly. External scripts (public/theme-init.js and
// the /_next/static/chunks/* bundles) stay covered by `script-src 'self'`.
//
// TRADE-OFF (acknowledged): a per-request nonce forces DYNAMIC rendering —
// static generation / ISR / PPR are incompatible with nonce CSP because a
// prebuilt shell can't know the request's nonce. That cost was paid on every
// route until 2026-08-09; it is now paid on every route EXCEPT the ones named
// in CDN_CACHED_DOCUMENT_PATHS above, which is where the reasoning for the
// exception lives.
//
// This file is `proxy.ts` (not `middleware.ts`): Next.js 16 renamed the
// middleware convention to `proxy` (runs on the Node runtime). Every OTHER
// security header (HSTS, nosniff, XFO, Permissions-Policy, COOP, Referrer)
// still ships from next.config.mjs on `/:path*`; only the CSP moved here so it
// can be built per-request with the live nonce.
//
// This function is NOT the export Next.js runs - `proxy` at the bottom of this
// file is. Every `/api` caller comes here directly. Other matched requests go
// through clerkMiddleware(), whose handler calls this function. Keeping the
// security logic as its own named function lets redirect and CSP tests drive
// it with no Clerk key or NextFetchEvent.
export function securityProxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (servesApiCaller(pathname)) {
    if (pathname.length > 1 && pathname.endsWith("/")) {
      const canonicalUrl = new URL(request.url);
      canonicalUrl.pathname = pathname.slice(0, -1);
      return applyNonProductionRobotsTag(
        NextResponse.redirect(canonicalUrl, 308),
      );
    }
    // F-10: misconfigured durable-store refusal is for the canonical host only.
    // Cron and webhooks hit the deployment *.vercel.app host and must not 503
    // here when preview-style env is absent on a production-labelled deploy.
    if (requestHostname(request) === CANONICAL_HOST) {
      const refused = serverEnvRefusalResponse();
      if (refused) {
        return applyNonProductionRobotsTag(
          new NextResponse(refused.body, {
            status: refused.status,
            statusText: refused.statusText,
            headers: refused.headers,
          }),
        );
      }
    }
    return applyNonProductionRobotsTag(NextResponse.next());
  }
  if (shouldRedirectVercelHost(request)) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.protocol = "https:";
    canonicalUrl.host = CANONICAL_HOST;
    canonicalUrl.port = "";
    const response = NextResponse.redirect(canonicalUrl, 308);
    // Tell crawlers not to keep the deployment hostname in the index while the
    // 308 is in flight. Production previews already noindex via
    // applyNonProductionRobotsTag; this covers production *.vercel.app aliases.
    response.headers.set("X-Robots-Tag", "noindex");
    return applyNonProductionRobotsTag(response);
  }
  if (servesIngestRelay(pathname)) {
    return applyNonProductionRobotsTag(NextResponse.next());
  }
  if (pathname.length > 1 && pathname.endsWith("/")) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.pathname = pathname.slice(0, -1);
    return applyNonProductionRobotsTag(
      NextResponse.redirect(canonicalUrl, 308),
    );
  }
  // List view lives on the map, not as a city slug. Without this, /map/list
  // hits [city]=list, fails parseCityId, and serves the global 404 copy. The
  // reader's own query rides along, as on every 308 below.
  if (pathname === MAP_LIST_PATH) {
    const target = new URL(request.url);
    target.pathname = "/map";
    target.searchParams.set(MAP_LIST_SEARCH_PARAM, "1");
    return applyNonProductionRobotsTag(NextResponse.redirect(target, 308));
  }
  // The city picker is ONE page, and it is /places. /choose-city is the address
  // it used to have. The canonical and the sitemap row moved to /places in the
  // same commit as this redirect (app/places/page.tsx, app/sitemap.ts): a 308
  // from the page carrying the canonical to a page shipping `noindex` takes the
  // city list out of the index rather than moving it.
  //
  // The query rides along because a 308 must not silently drop what a reader
  // asked for, not because /places reads any of it: the old `focus=search`
  // param has no reader there, and the retired address has no page at all.
  if (pathname === CHOOSE_CITY_PATH) {
    const target = new URL(request.url);
    target.pathname = PLACES_PATH;
    return applyNonProductionRobotsTag(NextResponse.redirect(target, 308));
  }
  // Out is Tonight now (product owner, Oct 2026 UX audit): the primary row is
  // Map, Tonight, Plan, Social, You, and Tonight carries what Out listed. /out keeps
  // its address for every old link and bookmark by answering a permanent 308
  // here, with the reader's own query riding along as on the 308s above.
  if (pathname === OUT_PATH) {
    const target = new URL(request.url);
    target.pathname = TONIGHT_PATH;
    return applyNonProductionRobotsTag(NextResponse.redirect(target, 308));
  }
  // Hyphenated alias of /login. /signin stays the existing page redirect.
  if (pathname === "/sign-in") {
    const target = new URL(request.url);
    target.pathname = "/login";
    return applyNonProductionRobotsTag(NextResponse.redirect(target, 308));
  }
  // Physical QR path (PLG Wave 2): printed codes use /?src=poster (+ optional
  // utm_*), and the scan opens nearby prices rather than the marketing landing.
  // It is decided here rather than in app/page.tsx because reading the query
  // string in that server component is exactly the per-request work that stops
  // the homepage being prerendered. 307, matching the redirect() it replaces:
  // a poster campaign is not a permanent address change.
  if (pathname === "/" && isPosterLandingSrc(request.nextUrl.searchParams.get("src"))) {
    return applyNonProductionRobotsTag(
      NextResponse.redirect(
        new URL(posterNearHref(request.nextUrl.searchParams), request.url),
        307,
      ),
    );
  }
  // /onboarding is the native shell's first-run surface, and the web
  // reaches it only by a client navigation from the first-run chip on /near
  // (`?start=web`, lib/firstRunRoute.ts). `consumeNativeFirstRunHandoff` is
  // native-only and session-scoped, so any other web visit has always failed
  // closed and replaced the URL with "/". It did that in the browser, after
  // rendering and discarding a whole document: it was the worst LCP on the site at 4676 ms on Slow 4G, because the paint
  // being measured was the homepage arriving after the bounce (Astra's live
  // walk, 7 Sep 2026, finding B6).
  //
  // The shell reaches this route two ways, and neither is turned away:
  //
  //   1. A fresh install decides its entry before first paint in
  //      public/theme-init.js and calls `window.location.replace` from
  //      "/app-entry" (or "/" in an older installed binary).
  //      That is a DOCUMENT request, but this origin's own page started it.
  //      Turning it away sent every fresh install to the landing page with the
  //      first-run mark already stamped, so onboarding never ran (14 Sep 2026).
  //   2. AppEntryRoute's `router.replace` from "/", for the one case the early
  //      script leaves to React. That is a client navigation and asks for no
  //      document at all.
  //
  // So only a document request that a page on this origin did NOT start is
  // turned away: a typed address, a bookmark, a link from another site. See
  // `startedOnThisOrigin` for how that is read on an older WebView.
  //
  // The document reading is `Accept`, not Next's own RSC header, which this
  // version strips before middleware anyway (measured), and not the `_rsc`
  // query, which it also strips. Measured on a production build: a browser
  // document navigation sends `text/html,...`, and every RSC navigation and
  // prefetch sends `*/*`. Reading Accept also FAILS SAFE. An RSC fetch cannot
  // start claiming to want HTML, so a future Next release cannot turn this
  // rule on the shell's client arrival; a header-name change could.
  //
  // 307, and never 308: a browser caches a permanent redirect, the shell is a
  // remote-URL wrap of this same origin, and one cached 308 would take the
  // first run away from every later install on that device.
  if (
    pathname === ONBOARDING_PATH &&
    wantsDocument(request) &&
    !startedOnThisOrigin(request)
  ) {
    const target = new URL(request.url);
    target.pathname = "/";
    target.search = "";
    return applyNonProductionRobotsTag(NextResponse.redirect(target, 307));
  }
  // A /map request whose DOCUMENT differs from the prerendered shell (a town
  // arrival, national browse, a curated share card) is rewritten to the twin
  // that renders it per request. The address bar keeps /map, and the twin is
  // the same page: only which requests pay for a render changes.
  const documentTwinUrl =
    pathname === MAP_DOCUMENT_PATH &&
    mapRequestNeedsDocumentTwin(request.nextUrl.searchParams)
      ? (() => {
          const target = new URL(request.url);
          target.pathname = MAP_DOCUMENT_TWIN_PATH;
          return target;
        })()
      : null;
  if (shouldSkipContentSecurityPolicy(request)) {
    return applyNonProductionRobotsTag(
      documentTwinUrl ? NextResponse.rewrite(documentTwinUrl) : NextResponse.next(),
    );
  }

  // The nonce exception, and the ONLY place it is decided. A prerendered
  // document cannot carry a per-request nonce - every visitor would be handed
  // the same one, which is the one thing a nonce may not be - so the
  // allow-listed paths take `script-src 'unsafe-inline'` instead. A /map
  // request rewritten to the twin above gets no CDN copy, so it has nothing to
  // buy with the nonce and keeps it.
  const cdnCachedDocument = servesCdnCachedDocument(pathname) && !documentTwinUrl;

  // Crypto-random, base64-encoded nonce (a fresh UUID per request).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  // The policy itself is built in lib/contentSecurityPolicy.mjs, which owns
  // the per-directive reasoning, so next.config.mjs can ship the SAME policy
  // for the CDN documents that no longer run this function on the canonical
  // host (lib/cdnDocumentEdge.mjs). The nonce slot is the only input that
  // differs: a prerendered document takes 'unsafe-inline' instead.
  const contentSecurityPolicy = buildContentSecurityPolicy({
    inlineScriptSource: cdnCachedDocument
      ? CDN_DOCUMENT_INLINE_SCRIPT_SOURCE
      : `'nonce-${nonce}'`,
    isDev,
    clerk: clerkCspSources(),
    supabase: supabaseCspOrigins(),
    devSupabaseConnect: devSupabaseConnectOrigin(process.env, isDev),
  });

  // Forward the nonce to the render: `x-nonce` for our own components
  // (app/layout.tsx et al. read it via next/headers), and the CSP itself on the
  // REQUEST header so Next.js can extract the nonce and stamp its inline scripts.
  //
  // A prerendered document is handed NEITHER header. There is no nonce to
  // forward, and a request header rewritten here would make the request
  // request-specific, which is the thing a CDN copy must not be.
  const forwardedRequest = cdnCachedDocument
    ? undefined
    : (() => {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("x-nonce", nonce);
        requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
        return { request: { headers: requestHeaders } };
      })();

  const response = documentTwinUrl
    ? NextResponse.rewrite(documentTwinUrl, forwardedRequest)
    : NextResponse.next(forwardedRequest);
  // And on the RESPONSE header so the browser actually enforces it.
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return applyNonProductionRobotsTag(response);
}

// THE SHIPPED ENTRY POINT. Clerk's quickstart says to create proxy.ts with
// `export default clerkMiddleware()`; this file already existed, so Clerk is
// COMPOSED with it via clerkMiddleware's handler form. Clerk establishes auth
// context for the requests that can use it, then calls securityProxy.
//
// AN /api CALLER NEVER ENTERS clerkMiddleware. Nothing under app/api reads
// Clerk auth: ownership stays on the Supabase bearer (`lib/authServer.ts`).
// `servesApiCaller` is the predicate. It sends every `/api` path, including a
// document-shaped GET, straight to securityProxy, so a Clerk handshake cannot
// answer before the trailing-slash redirect, the store refusal, or the route.
// `/ingest`, the PostHog relay, is not a Clerk consumer either, so
// `servesIngestRelay` sends it to securityProxy the same way. The matcher keeps
// it off the function entirely on the canonical host; this covers the
// `*.vercel.app` rule, which still claims it. Documents, `/__clerk` and every
// other matched path still enter clerkMiddleware. Revisit both predicates when
// a route first calls `auth()`.
//
// WHY A NAMED `proxy` EXPORT AND NOT `export default`:
// Next.js resolves the userland handler as `mod.proxy || mod.default`
// (packages/next/src/build/templates/middleware.ts), so the NAMED export wins.
// Leaving the old `export function proxy` in place beside a default Clerk
// export would have made Next keep running the un-composed function and Clerk
// would never have executed, with no error anywhere.
//
// WHY THE TERNARY, AND WHY IT NEEDS BOTH KEYS: clerkMiddleware() throws
// "@clerk/nextjs: Missing secretKey" on EVERY request when CLERK_SECRET_KEY is
// absent, so gating on the publishable key alone would turn a half-configured
// deployment into a site-wide 500 on pages that have nothing to do with
// identity. Verified by running this app with only the publishable key set.
// Requiring both keys means the worst half-configured case is browser-side
// Clerk with no server session, and the site itself stays up.
const clerkSecurityProxy = isClerkMiddlewareConfigured()
  ? clerkMiddleware(async (_auth, request) => securityProxy(request))
  : null;

export const proxy = clerkSecurityProxy
  ? (request: NextRequest, event: NextFetchEvent) =>
      servesApiCaller(request.nextUrl.pathname) ||
      servesIngestRelay(request.nextUrl.pathname)
        ? securityProxy(request)
        : clerkSecurityProxy(request, event)
  : securityProxy;

export const config = {
  matcher: [
    { source: "/api" },
    { source: "/api/:path*" },
    {
      source: "/:path*",
      has: [{ type: "host", value: ".+\\.vercel\\.app" }],
    },
    // The trailing-slash 308. `/ingest` is left out: PostHog's browser client
    // posts to `/ingest/e/` and `/ingest/flags/`, securityProxy hands every
    // `/ingest` path on untouched, and claiming them put a second function
    // invocation in front of every analytics event.
    { source: "/((?!ingest/).+)/" },
    // Clerk's own frontend API routes. Clerk requires the matcher to cover this
    // prefix so its handshake and session requests reach the middleware; it is
    // listed ahead of the general rule below because that rule's `missing`
    // prefetch clause must never be able to exclude a Clerk request.
    { source: "/__clerk/:path*" },
    // The CDN documents (`/`, `/map`, `/tonight`, `/today`, `/near`, `/plan`,
    // `/pal`) are left out of the general rule below, and their policy ships
    // from next.config.mjs `headers()`. These entries keep the proxy on the only requests for them it
    // still acts on: the poster QR landing (`/?src=`) and a /map query that
    // needs the per-request document twin. lib/cdnDocumentEdge.mjs owns the
    // rule; `__tests__/cdnDocumentEdge.test.ts` derives these and fails on drift.
    { source: "/", has: [{ type: "query", key: "src" }], missing: [{ type: "header", key: "next-router-prefetch" }] },
    { source: "/map", has: [{ type: "query", key: "place" }], missing: [{ type: "header", key: "next-router-prefetch" }] },
    { source: "/map", has: [{ type: "query", key: "uk" }], missing: [{ type: "header", key: "next-router-prefetch" }] },
    { source: "/map", has: [{ type: "query", key: "band" }], missing: [{ type: "header", key: "next-router-prefetch" }] },
    { source: "/map", has: [{ type: "query", key: "crawl" }], missing: [{ type: "header", key: "next-router-prefetch" }] },
    { source: "/map", has: [{ type: "query", key: "pubs" }], missing: [{ type: "header", key: "next-router-prefetch" }] },
    { source: "/map", has: [{ type: "query", key: "card" }], missing: [{ type: "header", key: "next-router-prefetch" }] },
    // The general rule, and the ONE place a request is kept out of this
    // function entirely. Beside the framework's own static prefixes it now
    // excludes every public asset directory: `/data`, the map's packs included,
    // plus brand, fonts, landing, night-signals, store-assets and vendor. Those
    // are pure bytes the CDN already holds, and running a Node function in
    // front of them bought nothing while putting a function failure in front of
    // a healthy file. The last branch does the same for the files at the root
    // of public/ and the /pal art, by extension, and ONLY there (a dynamic page
    // such as /u/foo.png must keep its nonce): theme-init.js and
    // map-first-paint-init.js load in <head>, so a cold start here delayed
    // first paint. The final branches leave out the CDN documents (see
    // the query entries above). Next only reads a matcher it can analyse STATICALLY, so
    // the alternation is written out here as a literal;
    // `__tests__/staticAssetPrefixes.test.ts` derives it from
    // lib/staticAssetPrefixes.mjs and fails when the two drift, and the same
    // fence refuses a prefix that collides with an app route.
    {
      source:
        "/((?!api|ingest|_next/static|_next/image|_next/hmr|favicon.ico|data/|brand/|fonts/|landing/|night-signals/|store-assets/|vendor/|(?:pal/)?[^/?]*\\.(?:js|json|geojson|webmanifest|png|jpg|jpeg|webp|avif|svg|ico|ttf|woff|woff2|txt)$|$|map$|tonight$|today$|near$|plan$|pal$).*)",
      // Next's router prefetch (an RSC fetch) is kept out. The browser's own
      // `Purpose: prefetch` is NOT: it marks a document prefetch or a
      // speculation-rules prerender, which the reader is then shown, so it
      // must run this function for its CSP, Clerk and redirects. See
      // shouldSkipContentSecurityPolicy and `__tests__/clerkProxyCsp.test.ts`.
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
} satisfies ProxyConfig;
