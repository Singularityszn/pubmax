// THE LOCAL NO-MISTAKES GATE IS CHANGE-SCOPED; THE FULL SUITE RUNS ONCE, IN CI.
//
// `scripts/verify-changed.mjs` plans the local run from the diff against the
// merge-base with origin/main. It runs the full `npm run verify` only when
// PUBMAX_VERIFY_FULL=1 is set or no merge-base exists. These cases pin that
// plan: what is linted, typechecked and tested, and that CI still runs every
// unit test on every PR.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { POSTGRES_BACKED_SUITES } from "../scripts/rls/postgresSuites.mjs";
import {
  checkSteps,
  importGraph,
  planChecks,
  type ChangedFile,
} from "../scripts/verify-changed.mjs";
import { unitShards } from "@/__tests__/helpers/ciWorkflow";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

const modified = (...paths: string[]): ChangedFile[] => paths.map((path) => ({ path, status: "M" }));

function plan(changed: ChangedFile[], options: Partial<Parameters<typeof planChecks>[0]> = {}) {
  return planChecks({
    changed,
    importers: new Map(),
    testFiles: [],
    readText: () => "",
    ...options,
  });
}

describe("the whole suite runs locally only on request", () => {
  it.each([
    "package.json",
    "vitest.config.mts",
    "tsconfig.json",
    "eslint.config.mjs",
    "__tests__/helpers/defined.ts",
    "scripts/verify-changed.mjs",
    "scripts/run-with-restored-bundled-data.mjs",
  ])("keeps a change to %s scoped and leaves the whole suite to CI", (path) => {
    const scoped = plan(modified(path));
    expect(scoped.full).toBeNull();
    expect(checkSteps(scoped).map((step) => step.label)).not.toContain("full merge bar");
  });

  it.each(["package.json", "vitest.config.mts"])("executes only related tests for a change to %s", (path) => {
    const fixture = mkdtempSync(join(ROOT, ".verify-changed-"));
    try {
      mkdirSync(join(fixture, "__tests__"));
      mkdirSync(join(fixture, "node_modules"));
      symlinkSync(join(ROOT, "node_modules/vitest"), join(fixture, "node_modules/vitest"), "dir");
      writeFileSync(join(fixture, "package.json"), JSON.stringify({ type: "module" }));
      writeFileSync(join(fixture, "vitest.config.mts"), `
        import config from ${JSON.stringify(join(ROOT, "vitest.config.mts"))};
        export default {
          test: {
            ...config.test,
            setupFiles: [],
            globalSetup: [],
            environment: "node",
            include: ["__tests__/*.test.ts"],
          },
        };
      `);
      writeFileSync(join(fixture, "__tests__/related.test.ts"), `
        import { expect, test } from "vitest";
        import value from "../${path}";
        test("checks the changed input", () => expect(value).toBeDefined());
      `);
      writeFileSync(join(fixture, "__tests__/unrelated.test.ts"), `
        import { test } from "vitest";
        test("must remain outside the local scope", () => { throw new Error("Unrelated test executed"); });
      `);
      const testFiles = ["__tests__/related.test.ts", "__tests__/unrelated.test.ts"];
      const readText = (file: string) => readFileSync(join(fixture, file), "utf8");
      const scoped = plan(modified(path), {
        importers: importGraph([path, ...testFiles], readText),
        testFiles,
        readText,
      });
      const step = defined(checkSteps(scoped).find((step) => step.label === "unit tests (related)"));
      const report = join(fixture, "results.json");
      const result = spawnSync(join(ROOT, step.command), [...step.args, "--reporter=json", `--outputFile=${report}`], {
        cwd: fixture,
        env: { ...process.env, ...step.env },
        encoding: "utf8",
      });
      // The captain's scope decision requires one related test and excludes the failing sentinel.
      const output = JSON.parse(readFileSync(report, "utf8"));
      expect(result.status, `${result.stdout}\n${result.stderr}\n${JSON.stringify(output)}`).toBe(0);
      expect(output.numPassedTests).toBe(1);
      expect(output.testResults.map((suite: { name: string }) => suite.name)).toEqual([
        join(fixture, "__tests__/related.test.ts"),
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("tests what relates to a module that many modules import, instead of the whole suite", () => {
    const hub = "lib/supabase.ts";
    const importers = new Map([[hub, new Set(Array.from({ length: 500 }, (_, i) => `app/r${i}/page.tsx`))]]);
    const scoped = plan(modified(hub), { importers });
    expect(scoped.full).toBeNull();
    expect(scoped.tests).toEqual([hub]);
  });

  it.each([
    ["lib/oldThing.ts", 'import "@/lib/oldThing";'],
    ["lib/oldThing.tsx", 'import "../lib/oldThing";'],
    ["lib/oldThing.mts", 'import "../lib/oldThing.mjs";'],
    ["lib/oldThing.mjs", 'const thing = import("../lib/oldThing.mjs");'],
    ["lib/oldThing.js", 'require("../lib/oldThing.js");'],
    ["lib/oldThing.cjs", 'vi.mock("@/lib/oldThing.cjs");'],
    ["lib/oldThing/index.ts", 'import "../lib/oldThing";'],
    ["lib/oldThing/index.tsx", 'import "@/lib/oldThing";'],
    ["lib/oldThing/index.mjs", 'import "../lib/oldThing";'],
    ["lib/oldThing/index.js", 'import "@/lib/oldThing";'],
    ["__tests__/helpers/postgres.ts", 'import "@/__tests__/helpers/postgres";'],
  ])("selects surviving dependants of the absent deleted module %s through %s", (target, statement) => {
    const suite = defined(POSTGRES_BACKED_SUITES[0]);
    const sources: Record<string, string> = {
      "components/Thing.tsx": statement,
      "__tests__/oldThing.test.ts": statement,
      "scripts/thing.mjs": statement,
      [suite]: 'import "../components/Thing";',
    };
    const readText = (path: string) => defined(sources[path]);
    const importers = importGraph(Object.keys(sources), readText, [target]);
    const scoped = plan([{ path: target, status: "D" }], {
      importers,
      testFiles: Object.keys(sources),
      readText,
    });
    expect(scoped.full).toBeNull();
    expect(scoped.typecheck).toEqual(["__tests__/oldThing.test.ts", "components/Thing.tsx"]);
    expect(scoped.tests).toEqual(["__tests__/oldThing.test.ts", "components/Thing.tsx", "scripts/thing.mjs"]);
    expect(scoped.rls).toBe(true);
  });

  it("runs npm run verify and nothing else when PUBMAX_VERIFY_FULL=1 is set", () => {
    const full = plan(modified("lib/x.ts"), { env: { PUBMAX_VERIFY_FULL: "1" } });
    expect(full.full).toContain("PUBMAX_VERIFY_FULL");
    expect(checkSteps(full).map((step) => [step.command, ...step.args].join(" "))).toEqual([
      "npm run verify",
    ]);
  });
});

describe("a change-scoped plan", () => {
  it("lints the changed scripts, typechecks them with their direct importers and tests what relates to them", () => {
    const importers = new Map([
      ["lib/priceLabel.ts", new Set(["components/PriceBadge.tsx", "scripts/report.mjs"])],
    ]);
    const scoped = plan(modified("lib/priceLabel.ts", "docs/VOICE.md"), { importers });

    expect(scoped.full).toBeNull();
    expect(scoped.lint).toEqual(["lib/priceLabel.ts"]);
    // allowJs is off, so only TypeScript files go to the compiler.
    expect(scoped.typecheck).toEqual(["components/PriceBadge.tsx", "lib/priceLabel.ts"]);
    expect(scoped.tests).toEqual(["docs/VOICE.md", "lib/priceLabel.ts"]);
  });

  it("typechecks only what the root tsconfig compiles", () => {
    const outside = ["e2e/map.spec.ts", ".agents/skills/x/vite.config.ts", ".next-prod/types/a.ts"];
    expect(plan(modified(...outside)).typecheck).toEqual([]);
  });

  it("adds the tests that name a changed file by its path, which no import graph can see", () => {
    const texts: Record<string, string> = {
      "__tests__/voiceFence.test.ts": 'readFileSync(join(ROOT, "docs/VOICE.md"))',
      "__tests__/other.test.ts": "nothing to see",
    };
    const scoped = plan(modified("docs/VOICE.md"), {
      testFiles: Object.keys(texts),
      readText: (path) => defined(texts[path]),
    });
    expect(scoped.tests).toEqual(["__tests__/voiceFence.test.ts", "docs/VOICE.md"]);
  });

  it("searches deleted paths for the tests that name them, but never hands vitest a deleted file", () => {
    const texts: Record<string, string> = {
      "__tests__/designTokens.test.ts": 'readFileSync("docs/DESIGN_SYSTEM.md")',
    };
    const scoped = plan([{ path: "docs/DESIGN_SYSTEM.md", status: "D" }], {
      testFiles: Object.keys(texts),
      readText: (path) => defined(texts[path]),
    });
    expect(scoped.tests).toEqual(["__tests__/designTokens.test.ts"]);
  });

  it("typechecks the importers of the .mjs module a changed .d.mts sidecar declares", () => {
    const importers = new Map([["scripts/lib/geo.mjs", new Set(["lib/venues.ts"])]]);
    const scoped = plan(modified("scripts/lib/geo.d.mts"), { importers });
    expect(scoped.typecheck).toEqual(["lib/venues.ts", "scripts/lib/geo.d.mts"]);
  });

  it("runs test:rls when a PostgreSQL suite depends on the change, directly or through other modules", () => {
    const suite = defined(POSTGRES_BACKED_SUITES[0]);
    const importers = new Map([
      ["lib/accountGate.ts", new Set(["app/api/account/route.ts"])],
      ["app/api/account/route.ts", new Set([suite])],
    ]);
    expect(plan(modified("app/api/account/route.ts"), { importers }).rls).toBe(true);
    expect(plan(modified("lib/accountGate.ts"), { importers }).rls).toBe(true);
    expect(plan(modified("lib/unrelated.ts"), { importers }).rls).toBe(false);
  });

  it("leaves the PostgreSQL suites to npm run test:rls, and runs it when the database layer changes", () => {
    const suite = defined(POSTGRES_BACKED_SUITES[0]);
    expect(plan(modified("lib/x.ts")).rls).toBe(false);
    for (const path of ["supabase/migrations/0200_x.sql", "scripts/rls/postgresHost.mjs", suite]) {
      expect(plan(modified(path)).rls, path).toBe(true);
    }
    expect(plan(modified(suite)).tests).not.toContain(suite);
  });

  it("validates data, database types, e2e skips and the ChatGPT map only when their inputs change", () => {
    const quiet = plan(modified("lib/x.ts"));
    expect([quiet.validateData, quiet.dbTypes, quiet.e2eSkips, quiet.chatgptMap]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(plan(modified("data/price_sources.json")).validateData).toBe(true);
    expect(plan(modified("public/data/cities/bath/venues_slim.manifest.json")).validateData).toBe(true);
    expect(plan(modified("supabase/migrations/0200_x.sql")).dbTypes).toBe(true);
    expect(plan(modified("types/database.ts")).dbTypes).toBe(true);
    // Every input scripts/db/generate-database-types.mjs reads.
    expect(plan(modified("scripts/rls/session-fixture.sql")).dbTypes).toBe(true);
    expect(plan(modified("scripts/qa/migration-apply-list.mjs")).dbTypes).toBe(true);
    expect(plan(modified("e2e/map.spec.ts")).e2eSkips).toBe(true);
    expect(plan(modified("scripts/chatgpt-map/src/server.ts")).chatgptMap).toBe(true);
  });

  it("runs vitest related on two workers, without the cluster suites, and fails on any failing test", () => {
    const steps = checkSteps(plan(modified("lib/priceLabel.ts")));
    const vitest = defined(steps.find((step) => step.label === "unit tests (related)"));

    expect(vitest.args.slice(0, 4)).toEqual(["related", "--run", "--maxWorkers=2", "--passWithNoTests"]);
    for (const suite of POSTGRES_BACKED_SUITES) {
      expect(vitest.args.join(" ")).toContain(`--exclude ${suite}`);
    }
    expect(vitest.args.at(-1)).toBe("lib/priceLabel.ts");
    // --passWithNoTests only forgives an empty selection, never a failure.
    expect(vitest.args).not.toContain("--allowOnly");
    expect(vitest.args.some((arg) => arg.startsWith("--bail") || arg === "--silent")).toBe(false);
  });

  it("always runs the whole-tree gates that only npm run verify runs", () => {
    const labels = checkSteps(plan(modified("lib/x.ts"))).map((step) => step.label);
    expect(labels).toContain("deadcode");
    expect(labels).toContain("install-script allowlist");
    // No workflow runs the advisory audit, so the scoped gate keeps it.
    expect(labels).toContain("dependency audit");
  });

  it("plans nothing to lint, typecheck or test for a docs-only change no test names", () => {
    const labels = checkSteps(plan(modified("docs/plans/x.md"))).map((step) => step.label);
    expect(labels).not.toContain("eslint (changed files)");
    expect(labels).not.toContain("typecheck (changed files and direct importers)");
  });
});

describe("the import graph", () => {
  it("resolves @/ aliases, relative specifiers and .mjs siblings to tracked files", () => {
    const sources: Record<string, string> = {
      "lib/a.ts": 'import { b } from "./b";\nexport const a = b;',
      "lib/b.ts": "export const b = 1;",
      "app/page.tsx": 'import { a } from "@/lib/a";\nconst lazy = () => import("../scripts/c.mjs");',
      "scripts/c.mjs": "export const c = 1;",
      "__tests__/a.test.ts": 'vi.mock("@/lib/b");\nimport "node:fs";',
    };
    const graph = importGraph(Object.keys(sources), (path) => defined(sources[path]));

    expect([...defined(graph.get("lib/b.ts"))].sort()).toEqual(["__tests__/a.test.ts", "lib/a.ts"]);
    expect([...defined(graph.get("lib/a.ts"))]).toEqual(["app/page.tsx"]);
    expect([...defined(graph.get("scripts/c.mjs"))]).toEqual(["app/page.tsx"]);
    expect(graph.has("node:fs")).toBe(false);
  });
});

describe("the full suite still runs once, in GitHub CI, on every code pull request", () => {
  it("keeps the CI unit shards on the whole suite through npm run coverage", () => {
    const workflow = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8"));
    expect(Object.keys(workflow.on)).toContain("pull_request");
    expect(workflow.on.pull_request).toBeNull();

    const shards = unitShards();
    expect(shards.length).toBeGreaterThanOrEqual(2);
    for (const { words } of shards) {
      expect(words.slice(0, 4)).toEqual(["npm", "run", "coverage", "--"]);
      expect(words).not.toContain("related");
      expect(words.some((word) => word.startsWith("--changed"))).toBe(false);
    }
  });
});
