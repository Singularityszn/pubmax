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

import { AGENT_TOOLING_PATHS } from "@/lib/agentToolingPaths.mjs";

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
      // Dead code knip cannot see from the compiler. On a branch the wrapper
      // fails only findings the branch introduced; on main it is full-tree knip.
      "npm run deadcode",
      "npm run test:review-dedup",
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

  it("keeps full-tree knip as deadcode:all, and points verify's deadcode at the branch gate", () => {
    const scripts = packageScripts();
    expect(scripts.deadcode).toBe("node scripts/deadcode-gate.mjs");
    expect(scripts["deadcode:all"]).toBe("knip");
    expect(scripts.verify).toContain("npm run deadcode");
    expect(scripts.verify).not.toContain("deadcode:all");
  });
});

describe("the directories agent tooling writes into this checkout", () => {
  // TWO HAND-WRITTEN COPIES OF ONE SET IS HOW `.gitnexus/` FELL BETWEEN THEM.
  // eslint and knip each carried their own list; they disagreed in five
  // entries, and neither named the MCP server's index, so `npm run lint` - and
  // therefore `npm run verify` and the pre-push hook - exited 1 on a clean tree
  // for three errors in a gitignored file nobody here wrote.
  const configs: ReadonlyArray<readonly [string, string]> = [
    ["eslint.config.mjs", "eslint"],
    ["knip.config.ts", "knip"],
  ];

  it.each(configs)("has %s read the one shared list", (file) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    expect(
      source,
      `${file} must import AGENT_TOOLING_PATHS rather than restate it`,
    ).toContain("AGENT_TOOLING_PATHS");

    for (const path of AGENT_TOOLING_PATHS) {
      const literal = JSON.stringify(path);
      expect(
        source.includes(literal),
        `${file} restates ${path}; read it from lib/agentToolingPaths.mjs`,
      ).toBe(false);
    }
  });

  it("names the MCP index, and never a directory this tree writes source into", () => {
    // `.gitnexus/` is the entry the two lists both missed. It is gitignored and
    // ships a CommonJS entry file full of require() calls, so an unignored copy is a red
    // merge bar on every machine the tool has run against.
    expect(AGENT_TOOLING_PATHS).toContain(".gitnexus/**");

    // The list is a lint and dead-code exemption, so an app directory on it
    // would silence both gates over real source rather than over tooling.
    const appSource = [
      "app",
      "components",
      "lib",
      "__tests__",
      "scripts",
      "e2e",
      "supabase",
    ];
    for (const path of AGENT_TOOLING_PATHS) {
      const directory = path.replace(/\/\*\*$/, "").replace(/\/$/, "");
      expect(
        appSource.includes(directory),
        `${path} names app source; the tooling list may only exempt directories tooling writes`,
      ).toBe(false);
    }
  });
});
