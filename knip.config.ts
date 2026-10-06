// KNIP IS THE DEAD-CODE GATE: UNREAD FILES, UNREAD EXPORTS, UNREAD DEPENDENCIES.
//
// `npm run deadcode` runs scripts/deadcode-gate.mjs: same knip, then on a
// branch subtracts findings origin/main already has. `npm run deadcode:all`
// is the unfiltered run. `verify` runs deadcode after `typecheck` and
// `__tests__/qualityGateWiring.test.ts` holds both scripts.
//
// This is `.ts` rather than `.json` so the agent-tooling ignore list is READ
// from lib/agentToolingPaths.mjs rather than being a second hand-written copy
// of eslint's. The two lists already disagreed in five entries before they
// were folded; see that module's header.
//
// EVERY OTHER IGNORE ENTRY CARRIES THE REASON THE FILE IS REACHED FROM
// OUTSIDE THE JAVASCRIPT IMPORT GRAPH. A file knip cannot see a caller for is
// not automatically dead: a workflow, a Python step, a fence test reading
// source text, or a documented refresh command all count as a caller.
import { readdirSync } from "node:fs";
import path from "node:path";

import type { KnipConfig } from "knip";

import { AGENT_TOOLING_PATHS } from "./lib/agentToolingPaths.mjs";

/**
 * A plain `.mjs` leaf beside a `.d.mts` sidecar is ONE module in two files, and
 * knip cannot judge either half on its own: TypeScript resolution sends an
 * `import ... from "@/lib/foo.mjs"` to `lib/foo.d.mts`, so the sidecar looks
 * like a file nobody imports AND the implementation's exports look like exports
 * nobody reads. Deleting on that reading is how a live export disappears while
 * `tsc` stays green off the stale sidecar. So the pair leaves the graph
 * together, and the tests that import these leaves are what fences them.
 */
function declaredMjsPairs(roots: readonly string[]): string[] {
  const paired: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") walk(full);
      else if (entry.name.endsWith(".d.mts")) paired.push(full.replace(/\.d\.mts$/, ".mjs"));
    }
  };
  for (const root of roots) walk(root);
  return paired;
}

const config: KnipConfig = {
  // The implementation half of every `.mjs` + `.d.mts` pair enters as an entry
  // rather than an ignore: knip then traces what it imports, and stops judging
  // exports it reads through the sidecar. See declaredMjsPairs above.
  entry: [
    ...declaredMjsPairs(["lib", "scripts"]),
    // Refreshes __tests__/fixtures/typesafe/pint-price-judgment-probabilities.json
    // and needs TYPESAFE_API_KEY. An entry rather than an ignore, so knip keeps
    // tracing what it imports: the judgment leaf it calls is reached from here
    // and nowhere else, and an ignore would report that leaf as dead.
    "scripts/harvest/uk-prices/record-judgment-fixtures.mjs",
    // Refreshes __tests__/fixtures/typesafe/conciergeIntentProbabilities.json
    // and needs TYPESAFE_API_KEY.
    "scripts/record_concierge_intent_probabilities.ts",
    // Standalone disposable Plan browser proof; traces its database helper too.
    "scripts/e2e/run-disposable-plan-browser.mjs",
  ],
  ignore: [
    ...AGENT_TOOLING_PATHS,

    // The sidecar half of every `.mjs` + `.d.mts` pair; see declaredMjsPairs.
    "**/*.d.mts",

    // Evidence scripts kept beside the proof they produced. A proof README
    // names its script as the way to reproduce the run.
    "docs/proof/**",
    "scripts/clerk-auth-firefox-proof.mjs",
    "scripts/venue-truth-shots.mjs",
    // Refreshes TypeSafe fixture probabilities for Pub Pal fence tests.
    "scripts/record_pubpal_fence_probabilities.ts",
    // The same, for Ask-router fixtures: needs TYPESAFE_API_KEY and writes
    // __tests__/fixtures/typesafe/ask-router-probabilities.json.
    "scripts/record_ask_router_probabilities.ts",
    // The same, for the same-pub identity fixtures: needs TYPESAFE_API_KEY and
    // writes __tests__/fixtures/typesafe/same-pub-probabilities.json.
    "scripts/record_same_pub_fixture_probs.mjs",
    // Refreshes TypeSafe fixture probabilities for NHLE listing-structure tests.
    "scripts/record_heritage_structure_fixture_probs.mjs",
    // The same, for Ask venue-resolution fixtures: needs TYPESAFE_API_KEY and
    // writes __tests__/fixtures/typesafe/venue-resolution-probabilities.json.
    "scripts/record_venue_resolution_probs.ts",

    // Manual evidence CLIs documented beside their proof output.
    "scripts/map-fix-shots.mjs",
    "scripts/report_borough_coverage.mjs",
    // Named by docs/data/uk-osm-extract-2026-10-04.md as the ONE way to rewrite
    // that doc's figures ("Do not edit the figures by hand").
    "scripts/report_uk_venue_extract.mjs",

    // Runtime-loaded browser files: service workers registered through
    // navigator.serviceWorker.register() and the theme script inlined by a
    // <script> tag. Loaded by the browser, never imported.
    "public/sw.js",
    "public/sw-plan-cache.js",
    "public/theme-init.js",

    // Read from disk by an e2e spec rather than imported.
    "e2e/fixtures/**",

    // Read by .github/workflows/api-performance.yml.
    "lib/productionDeploymentHosts.mjs",

    // App code imports the .ts wrapper through @/lib/siteContact; knip
    // resolves the bare specifier to the .mjs leaf and loses the wrapper.
    "lib/siteContact.ts",
    // Same shape: app code imports @/lib/httpUrl, the leaf is lib/httpUrl.mjs.
    "lib/httpUrl.ts",

    // Fence tests import these leaves to pin a published number; no runtime
    // caller is the point of them.
    "lib/apiBudgets.ts",
    "lib/sponsorship.ts",

    // The perf baseline harness, run by hand and cited by perf/ evidence.
    "scripts/perf-baseline.mjs",

    // Run with execFileSync by scripts/perf-ab.mjs.
    "scripts/print-e2e-server-env.ts",

    // Run through command() strings by scripts/local-refresh/scheduler.mjs,
    // which knip cannot follow across the process boundary.
    "scripts/firecrawl_greene_king_prices.mjs",
    "scripts/firecrawl_mbplc_prices.mjs",
    // Read only by those two harvesters, so it leaves the graph with them.
    "scripts/lib/venueMatch.mjs",
    "scripts/merge_london_chain_gazetteer.mjs",
    "scripts/merge_outer_london_gazetteer.mjs",

    // Run with subprocess.run() by the Python dataset builders.
    "scripts/classify_borough_points.mjs",
    "scripts/repair_borough_labels.mjs",
    "scripts/lib/boroughFromPoint.mjs",
    "scripts/resolve_postcode_coordinate_decisions.mjs",
    "scripts/lib/postcodeCoordinateDecisions.mjs",

    // Named as the refresh command for a lane in data/freshness_registry.json,
    // which `npm run check:freshness` reads.
    "scripts/build_area_news_matches.mjs",
    "scripts/build_persona_drinks.mjs",
    "scripts/refresh_pint_price_observations.mjs",

    // Generators for committed assets and data, documented beside the output
    // they write.
    "scripts/enrich_heritage.mjs",
    "scripts/enrich_landmark_attribution.mjs",
    "scripts/gen-native-app-icons.mjs",
    "scripts/gen-pubpal-mascot.mjs",
    "scripts/gen-store-assets.mjs",
    "scripts/landing/build-landing-map.mjs",
    "scripts/landing/build-landing-photos.mjs",
    "scripts/landing/build-london-collage.mjs",
    "scripts/harvest/uk-pubs/start-bars-when-pubs-done.mjs",
    "scripts/whatson/quizRefresh.mjs",
    "scripts/whatson/scrape_greene_king_sport.mjs",

    // Audit CLIs whose source text or output shape a fence test reads.
    "scripts/ui-ux-axe-audit.mjs",
    "scripts/ui-ux-battle-test.mjs",

    // Signed-in QA helper documented in docs/QA_SIGNED_IN_JOURNEYS.md.
    "scripts/qa/mint-signin-link.mjs",

    // MCP server entry named by .cursor/mcp.json, started by the agent
    // harness rather than imported.
    "scripts/run-browser-mcp.mjs",
  ],
  rules: {
    files: "error",
    exports: "error",
    types: "error",
    nsExports: "error",
    nsTypes: "error",
    enumMembers: "error",
    duplicates: "warn",
    unresolved: "off",
    dependencies: "error",
    devDependencies: "error",
    optionalPeerDependencies: "off",
    unlisted: "error",
    binaries: "error",
  },
  // Root tests and proof CLIs use postcss and playwright from the installed
  // toolchain (__tests__/iosFormZoomFloor.test.ts and
  // scripts/gen-store-screenshots.mjs). Neither is a direct root dependency.
  // The nested MCP package declares postcss itself; its proof CLIs use the
  // root Playwright installation, as scripts/chatgpt-map/README.md describes.
  // openai is imported only by @arizeai/openinference-instrumentation-openai when
  // Arize tracing registers; this app never imports it directly.
  ignoreDependencies: ["postcss", "playwright", "openai"],
  // System SysV IPC and process tools the postgres harness shells out to
  // (scripts/rls/postgresShm.mjs), the Google Cloud CLI, and pg_dump and
  // pg_restore, which the off-platform backup shells out to
  // (scripts/backup-offplatform.mjs). The pub-website amenity harvest mints its
  // Vertex token with gcloud, and the Places verify jobs read an access token
  // from it (scripts/lib/googlePlacesQuota.mjs). None of them is an npm binary.
  ignoreBinaries: ["ipcs", "ipcrm", "ps", "gcloud", "pg_dump", "pg_restore"],
};

// This optional local MCP CLI has its own pinned package manifest and named
// start/test/proof callers. Explicitly carry the original root entry and ignore
// graph: Knip stops using those top-level workspace fields once workspaces exist.
const { entry, ignore, ...workspaceConfig } = config;
workspaceConfig.workspaces = {
  ".": { entry, ignore },
  "scripts/chatgpt-map": {
    entry: ["*.test.mjs"],
    project: ["*.mjs"],
  },
};

export default workspaceConfig;
