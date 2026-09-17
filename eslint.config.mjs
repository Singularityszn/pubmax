import tsParser from "@typescript-eslint/parser";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

import { AGENT_TOOLING_PATHS } from "./lib/agentToolingPaths.mjs";

const eslintConfig = [
  {
    ignores: [
      // The directories agent tooling writes into this checkout. One list,
      // shared with knip: see lib/agentToolingPaths.mjs for why.
      ...AGENT_TOOLING_PATHS,
      // This tree's own build output and generated artifacts.
      ".next/**",
      ".next-*/**",
      ".vercel/**",
      "node_modules/**",
      "coverage/**",
      "public/data/**",
      // Copied from the pinned MapLibre package by predev/prebuild.
      "public/vendor/maplibre/**",
      "data/**",
      // Generated verification artifacts - never hand-authored source.
      "test-results/**",
      "playwright-report/**",
      // Local co-dev scratch probes (also gitignored); not part of the app.
      "scratch-*.mjs",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    // eslint-plugin-react still auto-detects React via the removed ESLint 10
    // RuleContext.getFilename() API (jsx-eslint/eslint-plugin-react#3977). Pin
    // the version so detect never runs. Drop once that plugin declares eslint 10.
    settings: {
      react: {
        version: "19",
      },
    },
  },
  {
    // eslint-config-next still parses JS/MJS with a Babel scope manager that
    // lacks ScopeManager#addGlobals (vercel/next.js#89764). Use the TS parser
    // for those extensions only; leave typescript-eslint's TS config alone.
    files: ["**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    // Global gate: any file not matched by the per-directory overrides below
    // must satisfy complexity 30. In flat-config, later blocks override
    // earlier ones for matching files, so this block goes FIRST and the
    // per-directory warn overrides come after.
    rules: {
      complexity: ["error", 30],
    },
  },
  // Complexity ratchet overrides for functions that pre-date the error/30
  // gate. Each group is annotated with the milestone that will bring the
  // functions below 30 through decomposition; delete the block once that
  // milestone lands so the global error/30 rule applies again.
  {
    // Scripts are offline data-pipeline tooling (never shipped to users).
    // Complexity will be reduced organically in Milestone 9 (Data Pipeline
    // Extraction). Keep as warn until then.
    files: ["scripts/**/*.{mjs,ts,js}"],
    rules: {
      complexity: ["warn", 30],
    },
  },
  {
    // Large map and app-shell components scheduled for decomposition in
    // Milestone 5 (Map Component Decomposition) and Milestone 6 (Plan/Night/
    // Admin Component Decomposition). Also the two API POST handlers whose
    // decomposition is deferred to the same waves.
    files: [
      "components/PubMap.tsx",
      "components/PubMapCanvas.tsx",
      "components/map/**/*.{ts,tsx}",
      "components/night/**/*.{ts,tsx}",
      "components/plan/**/*.{ts,tsx}",
      "components/profile/**/*.{ts,tsx}",
      "components/pal/**/*.{ts,tsx}",
      "components/social/**/*.{ts,tsx}",
      "components/visits/**/*.{ts,tsx}",
      "components/wanted/**/*.{ts,tsx}",
      "components/webmcp/**/*.{ts,tsx}",
      "components/feed/**/*.{ts,tsx}",
      "components/auth/**/*.{ts,tsx}",
      "app/admin/**/*.{ts,tsx}",
      "app/out/**/*.{ts,tsx}",
      "app/social/**/*.{ts,tsx}",
      "app/tonight/**/*.{ts,tsx}",
      "app/api/price-submit/**/*.{ts,tsx}",
      "app/api/social/**/*.{ts,tsx}",
    ],
    rules: {
      complexity: ["warn", 30],
    },
  },
  {
    // lib/ functions with legacy complexity. Many will simplify when their
    // callers are decomposed in Milestones 5/6. Track as warn until then.
    files: [
      "lib/analyticsEvents.ts",
      "lib/areaNews.ts",
      "lib/concierge/rank.ts",
      "lib/concierge/venues.server.ts",
      "lib/harvestFold.ts",
      "lib/heritage.ts",
      "lib/lastTrain.server.ts",
      "lib/mapSearchSuggest.ts",
      "lib/nightPlanning.ts",
      "lib/nightSignalClaims.ts",
      "lib/plan.ts",
      "lib/planComposerHandoff.ts",
      "lib/planDraft.ts",
      "lib/planGenerationRequest.ts",
      "lib/planGrounding.server.ts",
      "lib/planningAnchor.server.ts",
      "lib/slimShards.ts",
      "lib/socialCrewsUi.ts",
      "lib/socialPostStore.ts",
      "lib/spoonsValue.ts",
      "lib/venueIndex.ts",
      "lib/weatherSnapshots.ts",
      "lib/whatson/eventNormalise.mjs",
    ],
    rules: {
      complexity: ["warn", 30],
    },
  },
  {
    // E2E helper with complex layout-check logic. Tracked for refactoring
    // alongside future E2E suite improvements.
    files: ["e2e/ui-consistency-layout.spec.ts"],
    rules: {
      complexity: ["warn", 30],
    },
  },
];

export default eslintConfig;
