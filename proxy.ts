import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildCsp } from "./scripts/lib/cspPolicy.mjs";
import {
  SITE_JSON_LD_TEXT,
  SPECULATION_RULES_JSON,
} from "@/lib/inlineDocumentScripts";

// DYNAMIC-TIER Content-Security-Policy: a per-request nonce, applied ONLY to
// the routes that must render per request (auth/personal surfaces — see the
// matcher below). This is one half of the two-tier CSP:
//
//   - STATIC TIER: every statically generated route (/, /near, /tonight,
//     /about, /pint-index, /crawls, /discover, /feed, /borough/*, /historic/*,
//     ...) is served with a per-route sha256 hash CSP stamped into
//     .next/routes-manifest.json by scripts/build_csp_route_headers.mjs after
//     `next build`. A prebuilt shell can't know a request nonce, but hashes of
//     its own build output need no request state — so those routes stay
//     prerendered and edge-cached (the ~1s-TTFB fix) with NO 'unsafe-inline'.
//   - DYNAMIC TIER (this file): per-request nonce, exactly as before. Next.js
//     reads the nonce from the Content-Security-Policy REQUEST header and
//     stamps it onto every inline script it emits; our own dynamic pages read
//     `x-nonce` via next/headers.
//
// Shared invariants live in scripts/lib/cspPolicy.mjs (every non-script
// directive, single source) and are guarded by __tests__/cspPolicy.test.ts:
// script-src NEVER contains 'unsafe-inline' in either tier (owner decision,
// 2026-07-18), and every dynamic HTML page route must be matched here — the
// postbuild script fails the build if one is covered by neither tier.
//
// This file is `proxy.ts` (not `middleware.ts`): Next.js 16 renamed the
// middleware convention to `proxy` (runs on the Node runtime). Every OTHER
// security header (HSTS, nosniff, XFO, Permissions-Policy, COOP, Referrer)
// still ships from next.config.mjs on `/:path*`.

// The root layout renders two build-constant inline blocks on EVERY route
// (speculation rules + site JSON-LD, lib/inlineDocumentScripts.ts). The layout
// no longer threads a nonce (that read forced every route dynamic), so on
// nonce-governed routes those two blocks are allowed by their constant sha256
// hashes instead. Hashed once at module load — the content is build-constant.
const sha256 = (text: string) =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const DOCUMENT_SCRIPT_HASHES = [
  sha256(SPECULATION_RULES_JSON),
  sha256(SITE_JSON_LD_TEXT),
].join(" ");

export function proxy(request: NextRequest) {
  // Crypto-random, base64-encoded nonce (a fresh UUID per request).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  // script-src: NO 'unsafe-inline' (browsers ignore it whenever a nonce is
  //   present anyway). 'self' covers the external theme-init.js + the async
  //   /_next/static chunk bundles; 'nonce-<value>' covers Next's inline RSC
  //   bootstrap + hydration payload and our nonce-stamped page scripts; the two
  //   constant document-script hashes cover the layout's nonce-free inline
  //   blocks. Local `next dev` additionally gets 'unsafe-eval' (React dev
  //   tooling uses eval for call-stack reconstruction); production never does.
  //   NB: no 'strict-dynamic' — it would make the browser ignore the 'self'
  //   source expression, blocking the parser-inserted external theme-init.js.
  const scriptSrc = `script-src 'self' 'nonce-${nonce}' ${DOCUMENT_SCRIPT_HASHES}${isDev ? " 'unsafe-eval'" : ""}`;
  const contentSecurityPolicy = buildCsp(scriptSrc);

  // Forward the nonce to the render: `x-nonce` for our own components
  // (read via next/headers on dynamic pages), and the CSP itself on the
  // REQUEST header so Next.js can extract the nonce and stamp its inline
  // scripts.
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
  // DYNAMIC HTML ROUTES ONLY — the literal-matcher form of
  // scripts/lib/cspPolicy.mjs DYNAMIC_CSP_PREFIXES (Next.js requires the
  // matcher to be statically analyzable, so the list is spelled out here and
  // __tests__/cspPolicy.test.ts holds the two in lockstep; the postbuild
  // script fails the build on any dynamic page route neither tier covers).
  // Static routes are deliberately NOT matched: they carry the hash CSP from
  // the routes manifest, and skipping the proxy keeps them on the fastest
  // edge-cache path. `missing` skips router prefetches so they don't burn a
  // nonce on a payload the browser won't execute inline.
  // (Literal objects only: Next statically analyzes this config, so no .map().)
  matcher: [
    { source: "/bar-tab/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/crawls/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/landmark/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/ledger/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/map", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/map/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/messages/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/p/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/plan/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/recap/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/rounds/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
    { source: "/u/:path+", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] },
  ],
};
