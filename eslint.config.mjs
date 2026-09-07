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
    // Code-quality signal, not a build gate. Keeping complexity as a warning
    // surfaces new sprawl without blocking existing code. Ratchet the threshold
    // down as functions get refactored.
    rules: {
      complexity: ["warn", 35],
    },
  },
];

export default eslintConfig;
