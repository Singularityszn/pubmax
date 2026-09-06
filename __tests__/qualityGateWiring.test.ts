// A GATE THAT NOTHING RUNS IS NOT A GATE.
//
// `gate:e2e-skips`, `gate:playwright` and `check:freshness` were all defined,
// all unit-tested against fixtures, and all invoked by nothing: `verify` was
// validate-data, lint, typecheck, coverage and the audit. `npm run test:rls`
// was in no gate either, so the permission matrix - the one detector that has
// ever caught an RLS hole here - was proved by nobody. This file holds each
// gate to the place that runs it.
//
// The two lanes are deliberately different. A STATIC gate reads the tree, so
// it belongs in `verify`, the pre-push hook. A gate that judges a RUN needs
// that run's own artifact: `assert-playwright-gate.mjs` takes a Playwright
// JSON report, so putting it in `verify` would only ever print its usage line
// and fail every push. It belongs beside the browser suite that writes one.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function packageScripts(): Record<string, string> {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
}

function workflow(name: string): string {
  return readFileSync(join(ROOT, ".github/workflows", name), "utf8");
}

describe("the quality gates", () => {
  it("runs every static gate in the pre-push gate", () => {
    const verify = packageScripts().verify;

    for (const step of [
      "npm run validate-data",
      "npm run lint",
      "npm run typecheck",
      // A dead dependency is dead code no compiler sees, so knip is a static
      // gate: `knip.json` scopes it to dependency findings alone and it runs in
      // about three seconds.
      "npm run deadcode",
      "npm run coverage",
      // The proofs that need a real cluster, and a skip is a failure there.
      "npm run test:rls",
      "npm run gate:e2e-skips",
      "npm run check:freshness",
      "node scripts/resilient-audit.mjs",
    ]) {
      expect(verify, `verify must run ${step}`).toContain(step);
    }
  });

  it("keeps the pre-push hook pointed at that one gate", () => {
    const hook = readFileSync(join(ROOT, ".githooks/pre-push"), "utf8");
    expect(hook).toContain("npm run verify");
  });

  it("judges a browser run where the report exists, not before", () => {
    const verify = packageScripts().verify;
    // A report-consuming gate in the pre-push chain fails on its usage line.
    expect(verify).not.toContain("gate:playwright");

    const browser = workflow("e2e.yml");
    expect(browser).toContain("PLAYWRIGHT_JSON_OUTPUT_NAME");
    expect(browser).toContain("scripts/assert-playwright-gate.mjs");
  });
});
