import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
export function proxy(request: NextRequest) {
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
  const scriptSrc = `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`;

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
    "img-src 'self' data: blob: https://commons.wikimedia.org https://upload.wikimedia.org https://*.supabase.co https://*.googleusercontent.com https://gkbr-p-001.sitecorecontenthub.cloud",
    "font-src 'self' data: https://tiles.openfreemap.org",
    "connect-src 'self' https://tiles.openfreemap.org https://basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com https://*.supabase.co wss://*.supabase.co",
    "worker-src 'self' blob:",
    "child-src blob:",
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
  return response;
}

export const config = {
  // Apply to every request that renders an HTML document. Skip static assets
  // (/_next/static, /_next/image, favicon) and the JSON/binary /api routes —
  // none execute inline scripts, so a nonce'd CSP there is pointless. Skip
  // prefetch requests (the `missing` clause) so router prefetches don't burn a
  // nonce on a payload the browser won't execute inline. HTML documents at /,
  // /map, /feed, /borough/*, /plan/*, /crawls, /p/* all still match.
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
