// The document-level inline <script> payloads the root layout renders on EVERY
// route, extracted to constants so proxy.ts can hash them for the dynamic-tier
// CSP (script-src 'sha256-...') without the layout ever reading request state.
//
// WHY: the layout must stay free of headers()/cookies() so public routes can be
// statically generated and edge-cached (the ~1s-TTFB fix). That means the
// layout cannot thread a per-request nonce onto its own inline scripts anymore.
// Both payloads below are build-constant, so their sha256 hashes are stable and
// can ride in BOTH CSP tiers:
//   - static tier: scripts/build_csp_route_headers.mjs hashes them straight out
//     of the prerendered HTML (this module is not consulted there).
//   - dynamic tier: proxy.ts imports these constants and emits their hashes
//     alongside the per-request nonce, so the same layout markup stays allowed
//     on nonce-governed routes (/p/[id], /ledger/[id], /plan/*).
//
// HARD RULE: the strings exported here must be EXACTLY what the layout inlines
// (same serializer, same key order). __tests__/inlineDocumentScripts.test.ts
// locks that equivalence; if you edit a payload, edit it here only.

import { serializeJsonLd, type JsonLdGraph } from "@/components/seo/JsonLd";

// IDEAS B5 — Speculation Rules payload (see app/layout.tsx for the product
// rationale). JSON data block, never executed; still governed by script-src.
export const SPECULATION_RULES = {
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
} as const;

/** The exact inline text of the speculation-rules block. */
export const SPECULATION_RULES_JSON = JSON.stringify(SPECULATION_RULES);

// Site-wide JSON-LD (WebSite + Organization), moved verbatim from app/layout.tsx.
export const SITE_JSON_LD: JsonLdGraph = [
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

/** The exact inline text of the site JSON-LD block (JsonLd's own serializer). */
export const SITE_JSON_LD_TEXT = serializeJsonLd(SITE_JSON_LD);
