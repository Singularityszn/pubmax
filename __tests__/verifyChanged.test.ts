// THE LOCAL NO-MISTAKES GATE IS CHANGE-SCOPED; THE FULL SUITE RUNS ONCE, IN CI.
//
// Owner decision, 16 October 2026: the local pipeline ran the whole unit suite
// through `npm run coverage` (about 40 minutes on an 8 GB MacBook Air) and
// GitHub CI then ran it again. `scripts/verify-changed.mjs` now plans the local
// run from the diff against the merge-base with origin/main, and falls back to
// the full `npm run verify` when the change touches a shared foundation.
// These cases pin that plan: what escalates to the full suite, what is linted,
// typechecked and tested, and that CI still runs every unit test on every PR.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { POSTGRES_BACKED_SUITES } from "../scripts/rls/postgresSuites.mjs";
import {
  FULL_SUITE_FAN_IN,
  checkSteps,
  fullSuiteReason,
  importGraph,
  planChecks,
  type ChangedFile,
} from "../scripts/verify-changed.mjs";
import { unitShards } from "@/__tests__/helpers/ciWorkflow";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

const modified = (...paths: string[]): ChangedFile[] => paths.map((path) => ({ path, status: "M" }));

/** A graph in which `target` is imported directly by `count` distinct modules. */
function fanIn(target: string, count: number): Map<string, Set<string>> {
  return new Map([[target, new Set(Array.from({ length: count }, (_, i) => `app/r${i}/page.tsx`))]]);
}

function plan(changed: ChangedFile[], options: Partial<Parameters<typeof planChecks>[0]> = {}) {
  return planChecks({
    changed,
    importers: new Map(),
    testFiles: [],
    readText: () => "",
    ...options,
  });
}

describe("the full-suite escalation", () => {
  it.each([
    "package.json",
    "package-lock.json",
    "vitest.config.mts",
    "vitest.setup.ts",
    "tsconfig.json",
    "tsconfig.build.json",
    "eslint.config.mjs",
    "next.config.mjs",
    "__tests__/helpers/defined.ts",
    "scripts/verify-changed.mjs",
  ])("runs the whole merge bar when %s changes", (path) => {
    expect(fullSuiteReason(modified(path), new Map())).toContain(path);
  });

  it(`runs the whole merge bar for a module more than ${FULL_SUITE_FAN_IN} modules import`, () => {
    const hub = "lib/supabase.ts";
    expect(fullSuiteReason(modified(hub), fanIn(hub, FULL_SUITE_FAN_IN + 1))).toContain(hub);
    expect(fullSuiteReason(modified(hub), fanIn(hub, FULL_SUITE_FAN_IN))).toBeNull();
  });

  it("runs the whole merge bar when a source module is deleted, because nothing resolves to it", () => {
    expect(fullSuiteReason([{ path: "lib/oldThing.ts", status: "D" }], new Map())).toContain(
      "lib/oldThing.ts",
    );
    // A deleted doc or test file is imported by nothing.
    expect(fullSuiteReason([{ path: "docs/old.md", status: "D" }], new Map())).toBeNull();
    expect(fullSuiteReason([{ path: "__tests__/old.test.ts", status: "D" }], new Map())).toBeNull();
  });

  it("can be forced with PUBMAX_VERIFY_FULL=1", () => {
    expect(fullSuiteReason(modified("lib/x.ts"), new Map(), { PUBMAX_VERIFY_FULL: "1" })).toContain(
      "PUBMAX_VERIFY_FULL",
    );
  });

  it("plans npm run verify and nothing else on escalation", () => {
    const full = plan(modified("package.json"));
    expect(full.full).not.toBeNull();
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

describe("the full suite still runs once, in GitHub CI, on every pull request", () => {
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
