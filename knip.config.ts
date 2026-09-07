// KNIP IS SCOPED TO ONE QUESTION: IS A DECLARED DEPENDENCY STILL READ?
//
// Every other issue type is off on purpose. The unused-file and unused-export
// findings run to over a thousand rows on this tree, and a gate nobody can get
// to zero is a gate somebody deletes; the whole report is still one command
// away, `npm run deadcode:all`.
//
// This is `.ts` rather than `.json` so the ignore list is READ from
// lib/agentToolingPaths.mjs rather than being a second hand-written copy of
// eslint's. The two lists already disagreed in five entries before they were
// folded; see that module's header.
import type { KnipConfig } from "knip";

import { AGENT_TOOLING_PATHS } from "./lib/agentToolingPaths.mjs";

const config: KnipConfig = {
  ignore: [...AGENT_TOOLING_PATHS],
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
