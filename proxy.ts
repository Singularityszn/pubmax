import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest, ProxyConfig } from "next/server";

import { clerkCspSources, isClerkMiddlewareConfigured } from "@/lib/clerkIdentity";

const CANONICAL_HOST = "pubmaxxing.com";

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

function shouldRedirectVercelHost(request: NextRequest): boolean {
  if (!requestHostname(request).endsWith(".vercel.app")) return false;
  return !(
    process.env.VERCEL_ENV === "preview" &&
    isArtifactPreviewHost(request)
  );
}

function shouldSkipContentSecurityPolicy(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  const excludedPath =
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/_next/static" ||
    pathname.startsWith("/_next/static/") ||
    pathname === "/_next/image" ||
    pathname.startsWith("/_next/image/") ||
    pathname === "/favicon.ico";
  const prefetch =
    request.headers.has("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch";
  return excludedPath || prefetch;
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
// TRADE-OFF (acknowledged): a per-request nonce forces DYNAMIC rendering for
// every route — static generation / ISR / PPR are incompatible with nonce CSP
// because a prebuilt shell can't know the request's nonce.
//
// This file is `proxy.ts` (not `middleware.ts`): Next.js 16 renamed the
// middleware convention to `proxy` (runs on the Node runtime). Every OTHER
// security header (HSTS, nosniff, XFO, Permissions-Policy, COOP, Referrer)
// still ships from next.config.mjs on `/:path*`; only the CSP moved here so it
// can be built per-request with the live nonce.
//
// This function is NOT the export Next.js runs — `proxy` at the bottom of this
// file is, and it wraps this one with clerkMiddleware(). Keeping the security
// logic as its own named function is what lets the redirect and CSP tests drive
// it directly, with no Clerk key and no NextFetchEvent to fabricate.
export function securityProxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (shouldRedirectVercelHost(request)) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.protocol = "https:";
    canonicalUrl.host = CANONICAL_HOST;
    canonicalUrl.port = "";
    // Permanent host redirects still get the tag when not production so a
    // preview artifact never answers without noindex, even mid-redirect.
    return applyNonProductionRobotsTag(
      NextResponse.redirect(canonicalUrl, 308),
    );
  }
  if (pathname === "/ingest" || pathname.startsWith("/ingest/")) {
    return applyNonProductionRobotsTag(NextResponse.next());
  }
  if (pathname.length > 1 && pathname.endsWith("/")) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.pathname = pathname.slice(0, -1);
    return applyNonProductionRobotsTag(
      NextResponse.redirect(canonicalUrl, 308),
    );
  }
  if (shouldSkipContentSecurityPolicy(request)) {
    return applyNonProductionRobotsTag(NextResponse.next());
  }

  // Crypto-random, base64-encoded nonce (a fresh UUID per request).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  // script-src: NO 'unsafe-inline' (its removal is the entire point of this
  //   file — and browsers ignore 'unsafe-inline' whenever a nonce is present
  //   anyway). 'self' covers the external theme-init + the async /_next/static
  //   chunk bundles; 'nonce-<value>' covers Next's inline RSC bootstrap +
  //   hydration payload and our own nonce-stamped inline scripts. Local
  //   `next dev` additionally gets 'unsafe-eval' because React's development
  //   tooling uses eval for call-stack reconstruction; production never does.
  //   NB: no 'strict-dynamic' — it would make the browser ignore the 'self'
  //   source expression, blocking the parser-inserted external theme-init.js;
  //   Next's chunk loading is happy under plain 'self' + a nonce'd bootstrap.
  //   The one external host is va.vercel-scripts.com, which serves the Vercel
  //   Analytics SDK. Vercel injects that tag itself, so it carries no nonce of
  //   ours; the script is still consent-gated in the app (`beforeSend` cancels
  //   pre-consent pageviews — docs/OBSERVABILITY_CERTIFICATION.md), so allowing
  //   the origin does not widen what may be collected, only what may load.
  //   Clerk adds its instance Frontend API host (which serves clerk-js), the
  //   Cloudflare Turnstile challenge host and Clerk's abuse-protection hosts.
  //   Every one of them is an exact origin derived from the publishable key or
  //   named in lib/clerkIdentity.ts; NONE of them is 'unsafe-inline', and
  //   nothing here relaxes the nonce contract above. With no Clerk key set,
  //   `clerk.script` is empty and this line is byte-for-byte its old self.
  // Local development may point NEXT_PUBLIC_SUPABASE_URL at an auth stack on
  // this machine (`supabase start`, or a stub GoTrue for keyless auth testing);
  // the `*.supabase.co` allowance never covers that origin, so browser sign-in
  // silently dies under the CSP. The extra origin joins connect-src only under
  // `next dev` — production builds never widen.
  const devSupabaseConnect = (() => {
    if (!isDev) return "";
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return "";
    try {
      const origin = new URL(url).origin;
      return origin.endsWith(".supabase.co") ? "" : ` ${origin}`;
    } catch {
      return "";
    }
  })();

  const clerk = clerkCspSources();
  const clerkScript = clerk.script.map((origin) => ` ${origin}`).join("");
  const scriptSrc = `script-src 'self' 'nonce-${nonce}' https://va.vercel-scripts.com${clerkScript}${isDev ? " 'unsafe-eval'" : ""}`;

  // frame-src did not exist before Clerk: framing fell through to `child-src
  // blob:`, so blob: frames were the only ones allowed. Turnstile and Clerk's
  // abuse protection both render in iframes, so the directive becomes explicit
  // — and it KEEPS blob: so the fallback's existing permission is preserved
  // rather than quietly revoked. It stays absent entirely when Clerk is off.
  const clerkFrameSrc =
    clerk.frame.length > 0 ? [`frame-src blob: ${clerk.frame.join(" ")}`] : [];

  // Every non-script directive below is copied VERBATIM from the previous
  // static CSP in next.config.mjs. See that file's history for the per-directive
  // rationale (img-src allowlist, connect-src tiles/supabase/wss, style-src
  // 'unsafe-inline' for MapLibre's runtime style injection, worker/child blob:
  // for MapLibre tile workers + the offline service worker, etc.).
  const contentSecurityPolicy = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // img-src is deliberately MINIMAL — a "proxy-or-nothing" guard (image
    // rights audit U9, docs/IMAGE_RIGHTS_AUDIT_2026-07-21.md). Only origins the
    // BROWSER loads directly are listed: Wikimedia (landmark cards in
    // PubMapCanvas + /landmark/[id], via Special:FilePath which 302s to
    // upload.wikimedia.org), the Greene King Sitecore DAM (the 4 food-menu tiles
    // MenuCategoryGrid renders raw), *.supabase.co (community Pint Drop photos +
    // user avatars, our own bucket) and *.googleusercontent.com (Google IdP
    // sign-in/profile avatars). Every OTHER venue photo — the ~439 open-ended
    // pub-website hosts plus the brand/platform CDNs — is fetched server-side by
    // /api/image-proxy and re-served same-origin, so it loads under 'self' and
    // needs no entry here. The brand/platform origins that USED to be listed
    // (jdwetherspoon, greeneking, staticflickr, tripadvisor, squarespace-cdn,
    // inapub, wixstatic, whatpub S3, gstatic) were dead — never loaded directly —
    // and were removed so a future direct hotlink of unlicensed imagery fails
    // visibly instead of silently shipping. Do NOT re-add a third-party image
    // host here: route it through /api/image-proxy (and license it) instead.
    // Clerk adds https://img.clerk.com here, its own account-avatar CDN. It is
    // a first-party ACCOUNT image, not a third-party venue photo, so the
    // "proxy-or-nothing" rule above is untouched: no venue imagery may join it.
    `img-src 'self' data: blob: https://commons.wikimedia.org https://upload.wikimedia.org https://*.supabase.co https://*.googleusercontent.com https://gkbr-p-001.sitecorecontenthub.cloud${clerk.img.map((origin) => ` ${origin}`).join("")}`,
    "font-src 'self' data: https://tiles.openfreemap.org",
    // Clerk adds its Frontend API host (session, sign-in and sign-up calls) and
    // its abuse-protection hosts. Supabase's entries stay: both auth systems
    // run side by side, and removing either would break the other's sign-in.
    `connect-src 'self' https://tiles.openfreemap.org https://basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com https://*.supabase.co wss://*.supabase.co${devSupabaseConnect}${clerk.connect.map((origin) => ` ${origin}`).join("")}`,
    // Clerk also requires worker-src 'self' blob: — already true for MapLibre's
    // tile workers and the offline service worker, so it needs no change here.
    "worker-src 'self' blob:",
    "child-src blob:",
    ...clerkFrameSrc,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  // Forward the nonce to the render: `x-nonce` for our own components
  // (app/layout.tsx et al. read it via next/headers), and the CSP itself on the
  // REQUEST header so Next.js can extract the nonce and stamp its inline scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  // And on the RESPONSE header so the browser actually enforces it.
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return applyNonProductionRobotsTag(response);
}

// THE SHIPPED ENTRY POINT. Clerk's quickstart says to create proxy.ts with
// `export default clerkMiddleware()`; this file already existed, so Clerk is
// COMPOSED with it via clerkMiddleware's handler form instead — Clerk runs
// first, establishes the request's auth context, then calls securityProxy and
// returns whatever it returns (a 308 canonical redirect, or the nonce'd
// response). Neither the canonical-host redirect nor the CSP nonce is lost.
//
// WHY A NAMED `proxy` EXPORT AND NOT `export default`:
// Next.js resolves the userland handler as `mod.proxy || mod.default`
// (packages/next/src/build/templates/middleware.ts), so the NAMED export wins.
// Leaving the old `export function proxy` in place beside a default Clerk
// export would have made Next keep running the un-composed function and Clerk
// would never have executed — silently, with no error anywhere.
//
// WHY THE TERNARY, AND WHY IT NEEDS BOTH KEYS: clerkMiddleware() throws
// "@clerk/nextjs: Missing secretKey" on EVERY request when CLERK_SECRET_KEY is
// absent, so gating on the publishable key alone would turn a half-configured
// deployment into a site-wide 500 on pages that have nothing to do with
// identity. Verified by running this app with only the publishable key set.
// Requiring both keys means the worst half-configured case is browser-side
// Clerk with no server session, and the site itself stays up.
export const proxy = isClerkMiddlewareConfigured()
  ? clerkMiddleware(async (_auth, request) => securityProxy(request))
  : securityProxy;

export const config = {
  matcher: [
    {
      source: "/:path*",
      has: [{ type: "host", value: ".+\\.vercel\\.app" }],
    },
    { source: "/:path+/" },
    // Clerk's own frontend API routes. Clerk requires the matcher to cover this
    // prefix so its handshake and session requests reach the middleware; it is
    // listed ahead of the general rule below because that rule's `missing`
    // prefetch clause must never be able to exclude a Clerk request.
    { source: "/__clerk/:path*" },
    // Protected Social APIs resolve Clerk sessions server-side. Other APIs stay
    // outside Clerk middleware so keyless product routes keep their old path.
    { source: "/api/social/:path*" },
    {
      source: "/((?!api|ingest|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
} satisfies ProxyConfig;
