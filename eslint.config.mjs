import { existsSync } from "node:fs";

import tsParser from "@typescript-eslint/parser";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

import { ACCOUNT_SURFACE_FENCE_CONFIG } from "./lib/accountSurfaceLint.mjs";
import { OPERATOR_FACTS_FENCE_CONFIG } from "./lib/operatorFactsLint.mjs";
import { PINT_DROP_FENCE_CONFIG } from "./lib/pintDropLint.mjs";
import { PRICE_AUTHORITY_FENCE_CONFIG } from "./lib/priceAuthorityLint.mjs";
import { PRICE_READ_FENCE_CONFIG, priceReadAllowanceFiles } from "./lib/priceReadLint.mjs";
import { AGENT_TOOLING_PATHS } from "./lib/agentToolingPaths.mjs";
import { DEAL_HONESTY_FENCE_CONFIG, dealSurfaceFiles } from "./lib/dealHonestyLint.mjs";
import { ROUTER_CACHE_FENCE_CONFIG } from "./lib/routerCacheFence.mjs";
import { namedFiles, STATUS_WRITER_FENCE_CONFIG } from "./lib/statusWriterFence.mjs";

const goneLifecycleFiles = namedFiles().filter((file) => !existsSync(new URL(file, import.meta.url)));
if (goneLifecycleFiles.length > 0) {
  throw new Error(
    `lib/statusWriterFence.mjs names ${goneLifecycleFiles.join(", ")}, which no longer exists. Move the owner to the file that writes it.`,
  );
}

const missingDealSurfaces = dealSurfaceFiles.filter((file) => !existsSync(new URL(file, import.meta.url)));
if (missingDealSurfaces.length > 0) {
  throw new Error(`lib/dealHonestyLint.mjs names ${missingDealSurfaces.join(", ")}, which no longer exists.`);
}

const missingPriceReadFiles = priceReadAllowanceFiles.filter((file) => !existsSync(new URL(file, import.meta.url)));
if (missingPriceReadFiles.length > 0) {
  throw new Error(`Remove stale price-read allowances for missing files: ${missingPriceReadFiles.join(", ")}`);
}

// Retired rollout flags. Every block that sets no-restricted-syntax spreads
// these, because a later block replaces the rule's options for its files.
const RETIRED_FLAG_SYNTAX = [
  {
    selector: "Identifier[name='PUBMAX_MAP_ROUTE_TRANSFER']",
    message: "PUBMAX_MAP_ROUTE_TRANSFER is a retired rollout flag.",
  },
  {
    selector: "Literal[value='PUBMAX_MAP_ROUTE_TRANSFER']",
    message: "PUBMAX_MAP_ROUTE_TRANSFER is a retired rollout flag.",
  },
  {
    selector: "Identifier[name='PUBMAX_TONIGHT_GROUPING']",
    message: "PUBMAX_TONIGHT_GROUPING is a retired rollout flag.",
  },
  {
    selector: "Literal[value='PUBMAX_TONIGHT_GROUPING']",
    message: "PUBMAX_TONIGHT_GROUPING is a retired rollout flag.",
  },
  {
    selector: "Identifier[name='PUBMAX_PAL_HANDOFF']",
    message: "PUBMAX_PAL_HANDOFF is a retired rollout flag.",
  },
  {
    selector: "Literal[value='PUBMAX_PAL_HANDOFF']",
    message: "PUBMAX_PAL_HANDOFF is a retired rollout flag.",
  },
];

// A price publisher link goes through lib/priceSourceLink.ts, which refuses
// unsafe URLs and says "Link unavailable." (docs/VOICE.md). Spread into every
// block that sets no-restricted-syntax for app/ and components/.
const PRICE_SOURCE_HREF_SYNTAX = [
  {
    selector:
      "JSXAttribute[name.name='href'] > JSXExpressionContainer :matches(JSXExpressionContainer > MemberExpression, ChainExpression > MemberExpression):matches([object.name='publisher'], [object.property.name='publisher'], [object.property.name='sourcedPrice'], [object.property.name='listed'])",
    message: "Render a price publisher link with components/venue/PriceSourceName, or check it with safePriceSourceHref.",
  },
];

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
    // line back. Both are errors because warnings do not fail lint.
    // docs/CI_RUNBOOK.md owns the merge requirements.
    // The matching export-list debris (`export { a, b,  }`) has no core rule,
    // so __tests__/handWrittenSourceFence.test.ts scans for it instead.
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-extra-semi": "error",
    },
  },
  {
    files: [
      "app/**/*.{js,jsx,mjs,cjs,ts,tsx}",
      "components/**/*.{js,jsx,mjs,cjs,ts,tsx}",
      "lib/**/*.{js,jsx,mjs,cjs,ts,tsx}",
      "scripts/**/*.{js,jsx,mjs,cjs,ts,tsx}",
      "next.config.mjs",
      "playwright.config.ts",
      "proxy.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...RETIRED_FLAG_SYNTAX],
    },
  },
  {
    files: ["app/**/*.{jsx,tsx}", "components/**/*.{jsx,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...RETIRED_FLAG_SYNTAX, ...PRICE_SOURCE_HREF_SYNTAX],
    },
  },
  {
    // /map revalidates, so its read of the eager cell also runs on the server,
    // which holds only the files Next traced. Next traces a path it can read
    // statically: string literals joined to process.cwd().
    files: ["lib/mapOpeningPreview.server.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...RETIRED_FLAG_SYNTAX,
        {
          selector:
            "CallExpression:matches([callee.name='join'], [callee.property.name='join'])[arguments.0.callee.property.name='cwd'] > .arguments:not(:first-child):not(Literal)",
          message: "Spell this path as string literals so Next traces the file into the /map server bundle.",
        },
      ],
    },
  },
  // The client router cache is only safe while no page reads the request's
  // credential and nothing calls router.refresh(). See lib/routerCacheFence.mjs.
  ...ROUTER_CACHE_FENCE_CONFIG,
  // One writer module per persisted lifecycle. See lib/statusWriterFence.mjs.
  ...STATUS_WRITER_FENCE_CONFIG,
  ...PRICE_READ_FENCE_CONFIG,
  ...PRICE_AUTHORITY_FENCE_CONFIG,
  ...ACCOUNT_SURFACE_FENCE_CONFIG,
  ...OPERATOR_FACTS_FENCE_CONFIG,
  ...PINT_DROP_FENCE_CONFIG,
  ...DEAL_HONESTY_FENCE_CONFIG,
];

export default eslintConfig;
