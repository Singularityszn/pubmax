// Static-tier CSP: stamp per-route hash-based Content-Security-Policy headers
// into .next/routes-manifest.json AFTER `next build` (wired as npm `postbuild`,
// so both `npm run build` and Vercel's `npm run ci` get it automatically).
//
// WHY POST-BUILD: a statically generated page's inline scripts (Next's RSC
// bootstrap, our speculation rules, per-page JSON-LD) are fixed the moment the
// build finishes, so their sha256 hashes are computable — but only AFTER the
// HTML exists, which is later than next.config.mjs's headers() runs. Patching
// the routes manifest is the one supported-output place per-route headers can
// be attached post-build; both `next start` and Vercel read headers from it.
// Hashes are per-build by design (the RSC bootstrap embeds the build id):
// each build stamps hashes computed from ITS OWN output, so cross-build hash
// stability is never required.
//
// SECURITY INVARIANTS (build FAILS loudly rather than degrade):
//   1. script-src NEVER contains 'unsafe-inline' (owner decision, 2026-07-18).
//   2. Every prerendered HTML route gets a CSP header with exactly the hashes
//      of its own inline scripts.
//   3. Every DYNAMIC HTML page route must be covered by the nonce tier
//      (scripts/lib/cspPolicy.mjs DYNAMIC_CSP_PREFIXES → proxy.ts). A new
//      dynamic page outside that list aborts the build: no route can silently
//      ship with no CSP.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { buildCsp, DYNAMIC_CSP_PREFIXES } from "./lib/cspPolicy.mjs";

const NEXT_DIR = ".next";
const APP_DIR = join(NEXT_DIR, "server", "app");
const MANIFEST = join(NEXT_DIR, "routes-manifest.json");
const APP_PATHS = join(NEXT_DIR, "app-path-routes-manifest.json");
// Marker so re-runs replace (never duplicate) this script's entries.
const MARKER_KEY = "x-csp-tier";
const MARKER_VALUE = "static-hash";

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
  console.error(`csp-route-headers: ${msg}`);
  process.exit(1);
}

const routes = prerenderedHtml(APP_DIR);
if (routes.length === 0) fail("no prerendered HTML found under .next/server/app — did next build run?");

const headerEntries = routes.map(([route, file]) => {
  const hashes = inlineScriptHashes(readFileSync(file, "utf8"));
  if (hashes.length === 0) fail(`${route}: prerendered page has zero inline scripts — extraction regex is broken`);
  const scriptSrc = `script-src 'self' ${hashes.map((h) => `'sha256-${h}'`).join(" ")}`;
  const csp = buildCsp(scriptSrc);
  if (csp.includes("unsafe-inline") && !csp.includes("style-src 'self' 'unsafe-inline'"))
    fail("unexpected unsafe-inline outside style-src");
  if (/script-src[^;]*unsafe-inline/.test(csp)) fail("script-src gained unsafe-inline — refusing to ship");
  return {
    source: route,
    headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: MARKER_KEY, value: MARKER_VALUE },
    ],
  };
});

// Invariant 3: every dynamic HTML page route must fall under the nonce tier.
const appPaths = JSON.parse(readFileSync(APP_PATHS, "utf8"));
const prerendered = new Set(routes.map(([route]) => route));
const uncovered = [];
for (const [entry, routePath] of Object.entries(appPaths)) {
  if (!entry.endsWith("/page")) continue; // route handlers, metadata images, etc.
  const clean = routePath;
  // Error shells: served in place of whatever URL failed, so no path-scoped
  // header can target them and the nonce tier may not run. Documented gap —
  // the error pages carry no CSP (they render no user content).
  if (clean === "/_global-error" || clean === "/_not-found") continue;
  // A dynamic page: not in the prerendered set and not itself fully static
  // (param routes appear as /borough/[slug]; each prerendered instance was
  // handled above — what matters here is the on-demand fallback).
  const isPrerenderedStatic = prerendered.has(clean);
  const nonceCovered = DYNAMIC_CSP_PREFIXES.some(
    (p) => clean === p || clean.startsWith(p) || (p === "/map" && clean.startsWith("/map")),
  );
  const hasDynamicParams = clean.includes("[");
  if (isPrerenderedStatic && !hasDynamicParams) continue;
  if (hasDynamicParams) {
    // Param pages whose known instances are all prerendered still render
    // on-demand for unknown params (they notFound(), but the shell renders) —
    // they must ALSO be nonce-covered unless every instance is static AND the
    // route 404s unknown params. /borough/[slug] and /historic/[slug] both
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

// Patch the manifest: strip any previous run's entries, append this run's.
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
if (!Array.isArray(manifest.headers)) fail("routes-manifest.json has no headers array — Next output shape changed, refusing to guess");
manifest.headers = manifest.headers.filter(
  (h) => !(Array.isArray(h.headers) && h.headers.some((x) => x.key === MARKER_KEY)),
);
manifest.headers.push(...headerEntries);
writeFileSync(MANIFEST, JSON.stringify(manifest));

console.log(
  `csp-route-headers: stamped hash-CSP for ${headerEntries.length} static routes ` +
    `(example ${headerEntries[0].source}: ${inlineScriptHashes(readFileSync(routes[0][1], "utf8")).length} hashes); ` +
    `dynamic tier covers the rest via proxy.ts.`,
);
