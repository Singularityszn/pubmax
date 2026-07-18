// Static-tier CSP: inject a per-route hash-based Content-Security-Policy as a
// <meta http-equiv> tag INTO each prerendered HTML file AFTER `next build`
// (wired as npm `postbuild`, so both `npm run build` and Vercel's `npm run ci`
// get it automatically).
//
// WHY META, NOT HEADERS: a statically generated page's inline scripts (Next's
// RSC bootstrap, our speculation rules, per-page JSON-LD) are fixed the moment
// the build finishes, so their sha256 hashes are computable — but only AFTER
// the HTML exists, later than next.config.mjs's headers() runs. PR #374 tried
// stamping per-route headers into .next/routes-manifest.json; `next start`
// honoured them but the LIVE Vercel probe served the pages with no CSP header
// at all — Vercel does not consume post-build manifest patches. Vercel DOES
// upload and serve the build-output HTML bodies verbatim, so the policy now
// travels inside the document itself. The meta form enforces script-src
// hashes exactly like a header; the directives it cannot carry
// (frame-ancestors) ship as a build-static header from next.config.mjs.
// Hashes are per-build by design (the RSC bootstrap embeds the build id):
// each build stamps hashes computed from ITS OWN output, so cross-build hash
// stability is never required.
//
// SECURITY INVARIANTS (build FAILS loudly rather than degrade):
//   1. script-src NEVER contains 'unsafe-inline' (owner decision, 2026-07-18).
//   2. Every prerendered HTML route gets a meta CSP whose hash list is exactly
//      its own inline scripts', injected BEFORE the first <script> so every
//      script is governed (meta CSP applies from its insertion point).
//   3. Every DYNAMIC HTML page route must be covered by the nonce tier
//      (scripts/lib/cspPolicy.mjs DYNAMIC_CSP_PREFIXES → proxy.ts). A new
//      dynamic page outside that list aborts the build: no route can silently
//      ship with no CSP.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { buildMetaCsp, DYNAMIC_CSP_PREFIXES } from "./lib/cspPolicy.mjs";

const NEXT_DIR = ".next";
const APP_DIR = join(NEXT_DIR, "server", "app");
const APP_PATHS = join(NEXT_DIR, "app-path-routes-manifest.json");
// Marker attribute so re-runs replace (never duplicate) this script's tag, and
// so the deploy probe can grep for it in the live HTML.
const MARKER_ATTR = 'data-csp-tier="static-hash"';

/** All prerendered HTML files under .next/server/app, as [routePath, file]. */
function prerenderedHtml(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...prerenderedHtml(full));
    } else if (entry.endsWith(".html")) {
      const rel = relative(APP_DIR, full).split(sep).join("/");
      let route = `/${rel.slice(0, -".html".length)}`;
      if (route === "/index") route = "/";
      // Build internals, not user-routable paths.
      if (route === "/_global-error" || route === "/_not-found") continue;
      out.push([route, full]);
    }
  }
  return out;
}

/** sha256-base64 of every inline <script> body (any type; CSP gates them all). */
function inlineScriptHashes(html) {
  const hashes = [];
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m; (m = re.exec(html)); ) {
    if (!m[1]) continue;
    hashes.push(createHash("sha256").update(m[1], "utf8").digest("base64"));
  }
  return [...new Set(hashes)];
}

function fail(msg) {
  console.error(`csp-meta-static: ${msg}`);
  process.exit(1);
}

const routes = prerenderedHtml(APP_DIR);
if (routes.length === 0) fail("no prerendered HTML found under .next/server/app — did next build run?");

let stamped = 0;
for (const [route, file] of routes) {
  // Strip a previous run's tag first so re-runs are idempotent.
  let html = readFileSync(file, "utf8").replace(
    new RegExp(`<meta http-equiv="Content-Security-Policy"[^>]*${MARKER_ATTR}[^>]*>`, "g"),
    "",
  );
  const hashes = inlineScriptHashes(html);
  if (hashes.length === 0) fail(`${route}: prerendered page has zero inline scripts — extraction regex is broken`);
  const scriptSrc = `script-src 'self' ${hashes.map((h) => `'sha256-${h}'`).join(" ")}`;
  const csp = buildMetaCsp(scriptSrc);
  if (/script-src[^;]*unsafe-inline/.test(csp)) fail("script-src gained unsafe-inline — refusing to ship");
  if (/frame-ancestors/.test(csp)) fail("frame-ancestors leaked into the meta policy (ignored there) — it belongs to the next.config.mjs header");
  // Policy text contains only URL/token-safe characters, but escape the two
  // HTML-attribute-unsafe ones defensively anyway.
  const content = csp.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const tag = `<meta http-equiv="Content-Security-Policy" content="${content}" ${MARKER_ATTR}/>`;
  // Inject immediately after <head...> so the policy precedes EVERY script —
  // meta CSP only governs content after its insertion point (invariant 2).
  const headOpen = html.match(/<head[^>]*>/i);
  if (!headOpen || headOpen.index === undefined) {
    fail(`${route}: no <head> tag found`);
    continue;
  }
  const insertAt = headOpen.index + headOpen[0].length;
  const firstScript = html.search(/<script/i);
  if (firstScript !== -1 && firstScript < insertAt)
    fail(`${route}: a <script> precedes the <head> insertion point — meta CSP would not govern it`);
  html = html.slice(0, insertAt) + tag + html.slice(insertAt);
  writeFileSync(file, html);
  stamped += 1;
}

// Invariant 3: every dynamic HTML page route must fall under the nonce tier.
const appPaths = JSON.parse(readFileSync(APP_PATHS, "utf8"));
const prerendered = new Set(routes.map(([route]) => route));
const uncovered = [];
for (const [entry, routePath] of Object.entries(appPaths)) {
  if (!entry.endsWith("/page")) continue; // route handlers, metadata images, etc.
  const clean = routePath;
  // Error shells: served in place of whatever URL failed, so no path-scoped
  // delivery can target them and the nonce tier may not run. Documented gap —
  // the error pages carry no CSP (they render no user content).
  if (clean === "/_global-error" || clean === "/_not-found") continue;
  const isPrerenderedStatic = prerendered.has(clean);
  const nonceCovered = DYNAMIC_CSP_PREFIXES.some(
    (p) => clean === p || clean.startsWith(p) || (p === "/map" && clean.startsWith("/map")),
  );
  const hasDynamicParams = clean.includes("[");
  if (isPrerenderedStatic && !hasDynamicParams) continue;
  if (hasDynamicParams) {
    // Param pages whose known instances are all prerendered still render
    // on-demand for unknown params. /borough/[slug] and /historic/[slug] both
    // notFound() unknown slugs, so their on-demand render is the 404 page.
    const staticParamPages = ["/borough/[slug]", "/historic/[slug]"];
    if (staticParamPages.includes(clean)) continue;
    if (!nonceCovered) uncovered.push(clean);
    continue;
  }
  if (!nonceCovered) uncovered.push(clean);
}
if (uncovered.length > 0)
  fail(
    `dynamic HTML page route(s) covered by NEITHER CSP tier: ${uncovered.join(", ")}. ` +
      "Add them to DYNAMIC_CSP_PREFIXES (scripts/lib/cspPolicy.mjs) AND proxy.ts config.matcher.",
  );

console.log(
  `csp-meta-static: injected hash-CSP meta into ${stamped} static routes; dynamic tier covers the rest via proxy.ts.`,
);
