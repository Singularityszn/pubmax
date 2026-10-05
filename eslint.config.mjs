import tsParser from "@typescript-eslint/parser";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

import { AGENT_TOOLING_PATHS } from "./lib/agentToolingPaths.mjs";
import { ROUTER_CACHE_FENCE_CONFIG } from "./lib/routerCacheFence.mjs";

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
      // Copied from the pinned MapLibre and ElevenLabs packages by `npm run dev` and `npm run build`.
      "public/vendor/maplibre/**",
      "public/vendor/elevenlabs/**",
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
    // Code-quality signal, not a build gate. Keeping complexity as a warning
    // surfaces new sprawl without blocking existing code. Ratchet the threshold
    // down as functions get refactored.
    rules: {
      complexity: ["warn", 35],
    },
  },
  {
    // A stray `;` on its own line and an empty `{}` block are what a mechanical
    // edit leaves behind when it lifts a statement out and does not read the
    // line back. Both are errors so the tree cannot carry that debris:
    // `npm run lint` is the merge bar and a warning here would be ignored.
    // The matching export-list debris (`export { a, b,  }`) has no core rule,
    // so __tests__/handWrittenSourceFence.test.ts scans for it instead.
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-extra-semi": "error",
    },
  },
  // The client router cache is only safe while no page reads the request's
  // credential and nothing calls router.refresh(). See lib/routerCacheFence.mjs.
  ...ROUTER_CACHE_FENCE_CONFIG,
];

export default eslintConfig;
