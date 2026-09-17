import type { KnipConfig } from "knip";

import { AGENT_TOOLING_PATHS } from "./lib/agentToolingPaths.mjs";

const config: KnipConfig = {
  ignore: [
    ...AGENT_TOOLING_PATHS,

    // TypeScript declaration sidecars for plain .mjs modules. Knip cannot
    // trace the implicit .mjs ↔ .d.mts pairing, so every sidecar appears as
    // an unreferenced file even when its .mjs companion is fully used.
    "**/*.d.mts",

    // Runtime-loaded browser scripts: service workers registered via
    // navigator.serviceWorker.register() and theme-init inlined by <script>.
    // Not part of the app's import graph but loaded at runtime.
    "public/sw.js",
    "public/sw-plan-cache.js",
    "public/theme-init.js",

    // E2E fixtures read via fs at test time, not imported.
    "e2e/fixtures/**",
  ],
  rules: {
    files: "off",
    exports: "off",
    types: "off",
    nsExports: "off",
    nsTypes: "off",
    enumMembers: "off",
    duplicates: "off",
    unresolved: "off",
    dependencies: "error",
    devDependencies: "error",
    optionalPeerDependencies: "off",
    unlisted: "error",
    binaries: "error",
  },
  // Both ARE in devDependencies; the unlisted finding is knip classifying
  // their one caller each (__tests__/iosFormZoomFloor.test.ts,
  // scripts/gen-store-screenshots.mjs) as production.
  ignoreDependencies: ["postcss", "playwright"],
};

export default config;
