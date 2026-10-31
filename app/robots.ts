import type { MetadataRoute } from "next";

import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";

// Public paths are crawlable and every group keeps the same private-path
// exclusions. Named training and user-fetch tokens retain their existing
// permissions. Search crawlers without an explicit group use the wildcard.
// Search crawling, user fetching and model training are separate permissions.
//
// Disallow list — only surfaces that are private, member-tokened, or
// user-generated-ephemeral, never the public data surfaces:
//   /api/        JSON/al endpoints, not documents (the share-card images in
//                ALLOW below are the exception).
//   /admin       moderation console.
//   /p/          Pint Drop permalinks — friends-gated UGC keyed by an opaque id
//                (app/p/[id] withholds hidden/friends drops); not a public page.
//   /rounds/     live "Round" sessions keyed by a member round code (a shared
//                token) — app/rounds/[code] is a private crew presence surface.
//   /plan/       private crawl-planning sessions (per-user working state).
//   /bar-tab/    ephemeral per-visit tab; app/bar-tab/[id] is already noindex.
//   /ledger,     kept CRAWLABLE on purpose — /ledger/[id] is the canonical,
//                token-free venue permalink (the price + heritage moat), so it is
//                deliberately NOT disallowed.
//   /messages,   private user surfaces.
//   /profile,
//   /activity,
//   /auth
//   /map/arrival the per-request half of /map (lib/mapDocumentTwin.ts). Every
//                document it renders is canonically /map, so it is a render
//                target rather than an address; its pages say noindex too.
//
// Preview / development deployments (anything other than VERCEL_ENV=production)
// are NOT the product. They get a total disallow plus X-Robots-Tag from
// proxy.ts so a share link or lifted deployment protection cannot create a
// second indexed copy of pubmaxxing.com. The check is the Vercel env var, not
// the hostname — preview hosts change every deployment.
//
// Next caches this metadata route by default. The deployment environment
// selects the production or non-production policy.

// Explicitly-named AI + search crawlers we welcome. Listing them documents the
// "be AI-visible" decision; the policy each gets is the same as the wildcard.
const NAMED_AI_CRAWLERS = [
  "GPTBot", // OpenAI training crawler; search and user fetching are separate.
  "ClaudeBot", // Anthropic (Claude training crawler)
  "Claude-User", // Anthropic (Claude live user-initiated fetch)
  "PerplexityBot", // Perplexity
  "Google-Extended", // Google Gemini / Vertex data control token
  "Bingbot", // Bing search crawler.
] as const;

// Private / member-tokened / ephemeral-UGC surfaces kept out of every crawler.
const DISALLOW = [
  "/api/",
  "/admin",
  "/p/",
  "/rounds/",
  "/plan/",
  "/bar-tab/",
  "/messages",
  "/profile",
  "/activity",
  "/auth",
  "/map/arrival",
];

// Public share-card images that live under /api/ but are named as og:image /
// twitter:image by crawlable pages. A crawler that obeys robots.txt (Googlebot,
// Bingbot, Twitterbot, LinkedInBot) will not fetch an image the file disallows,
// so a blanket "/api/" left the homepage, crawl, list, pint and city links with
// no preview image in search results and on X. Each Allow is longer than
// "/api/", so under RFC 9309's longest-match rule it wins for its path only.
// /api/plan-card stays out: it draws /plan/, which is itself disallowed.
const ALLOW = [
  "/",
  "/api/home-card",
  "/api/crawl-card",
  "/api/chaos-card",
  "/api/city-map-card",
  "/api/list-card",
  "/api/pint-card",
  "/api/year-card",
];

function isProductionDeployment(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  return vercelEnv === "production";
}

export default function robots(): MetadataRoute.Robots {
  // Non-production: block every path. No sitemap, no host, no AI allow list —
  // a preview must never look crawlable even if protection is off.
  if (!isProductionDeployment()) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: [
      { userAgent: "*", allow: ALLOW, disallow: DISALLOW },
      // Named allow entries for the AI crawlers — same disallow set, explicit
      // welcome (documents intent to be AI-visible and citable).
      ...NAMED_AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: ALLOW,
        disallow: DISALLOW,
      })),
    ],
    sitemap: `${PRODUCTION_SITE_ORIGIN}/sitemap.xml`,
    host: PRODUCTION_SITE_ORIGIN,
  };
}
