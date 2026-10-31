// A DOCS OR DATA PULL REQUEST SKIPS THE HEAVY JOBS, AND NO REQUIRED CHECK
// WAITS FOR EVER (owner decision, 16 Oct 2026).
//
// Every heavy Linux job (unit shards, Coverage, the production build, lint and
// the typecheck, the browser law pins, effective RLS) classifies the pull
// request's diff in its own first step and skips its own steps when the change
// is only docs or only data. It never skips at the job level: a skipped matrix
// job reports one check under its unexpanded name ("Unit tests
// (${{ matrix.shard }}/2)"), and branch protection then waits for "Unit tests
// (1/2)" for ever. A job that runs and skips its steps reports success under
// its real name. The freshness gate, data validation, review scope and
// Security CI are not gated at all. docs/CI_RUNBOOK.md is the runbook.
//
// The macOS layout pins are the one exception (owner decision, 17 Oct 2026).
// The free plan runs only 5 macOS jobs at once, and a job that starts only to
// skip its steps still holds a macOS runner while it waits. So one Linux job,
// "Change scope", classifies the diff, and the three layout-pin jobs are
// skipped whole when it succeeds and says no screen code changed (captain,
// 23 Oct 2026). Main still runs them on every push. They are named
// jobs, not a matrix, so a skipped one reports under its own name, which
// branch protection counts as passed. If the classifier fails, they run.
//
// The classifier and the named-test step are EXECUTED here, against a
// stand-in `git` and `npx`, so these are pins on what the steps do, not on
// how they are spelled.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { POSTGRES_BACKED_SUITES } from "@/scripts/rls/postgresSuites.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();
const CLASSIFY = "Classify the change";
const CLASSIFY_LAYOUT = "Classify the layout change";
const NAMED_TESTS = "Unit tests that name a changed file";

type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown> };
type Job = { name?: string; if?: string; steps: Step[] };
type Workflow = { jobs: Record<string, Job> };

const workflows = readdirSync(join(ROOT, ".github/workflows"))
  .filter((file) => file.endsWith(".yml"))
  .sort()
  .map((file) => ({
    file,
    parsed: parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8")) as Workflow,
  }));

const gatedJobs = workflows.flatMap(({ file, parsed }) =>
  Object.entries(parsed.jobs)
    .filter(([, job]) => job.steps.some((step) => step.name === CLASSIFY))
    .map(([jobId, job]) => ({ where: `${file} / ${jobId}`, job })),
);

function job(where: string): Job {
  return defined(gatedJobs.find((entry) => entry.where === where), where).job;
}

function step(where: string, name: string): Step {
  return defined(job(where).steps.find((entry) => entry.name === name), `${where} / ${name}`);
}

const scratch = mkdtempSync(join(tmpdir(), "pubmax-ci-scope-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A `git` that answers `git diff --no-renames --name-only HEAD^1 HEAD` with FAKE_DIFF. */
function shimBin(): string {
  const bin = mkdtempSync(join(scratch, "bin-"));
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      'if [ "$*" = "diff --no-renames --name-only HEAD^1 HEAD" ]; then printf "%s" "$FAKE_DIFF"; exit "${FAKE_GIT_STATUS:-0}"; fi',
      'echo "unexpected git $*" >&2; exit 2',
    ].join("\n"),
  );
  // npx records what it was asked to run instead of running it.
  writeFileSync(join(bin, "npx"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$NPX_LOG"\n');
  chmodSync(join(bin, "git"), 0o755);
  chmodSync(join(bin, "npx"), 0o755);
  return bin;
}

const BIN = shimBin();

function runStep(
  run: string,
  env: Record<string, string>,
  { cwd = ROOT, realGit = false }: { cwd?: string; realGit?: boolean } = {},
): { status: number | null; output: string; stdout: string; stderr: string } {
  const outputFile = join(mkdtempSync(join(scratch, "out-")), "github-output");
  writeFileSync(outputFile, "");
  const path = realGit ? (process.env.PATH ?? "") : `${BIN}:${process.env.PATH ?? ""}`;
  const result = spawnSync("bash", ["-e", "-c", run], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: path, GITHUB_OUTPUT: outputFile, ...env },
  });
  return { status: result.status, output: readFileSync(outputFile, "utf8"), stdout: result.stdout, stderr: result.stderr };
}

const CLASSIFY_RUN = defined(step("ci.yml / unit-tests", CLASSIFY).run, "classifier run");

function scopeOf(files: string[], eventName = "pull_request"): string {
  const result = runStep(CLASSIFY_RUN, { EVENT_NAME: eventName, FAKE_DIFF: files.join("\n") + (files.length ? "\n" : "") });
  expect(result.status, result.stderr).toBe(0);
  return defined(/^scope=(\w+)$/m.exec(result.output)?.[1], `scope in ${result.output}`);
}

describe("the change scope", () => {
  it("is classified in exactly the heavy jobs, by one identical step", () => {
    expect(gatedJobs.map(({ where }) => where).sort()).toEqual([
      "ci.yml / coverage",
      "ci.yml / lint-and-types",
      "ci.yml / production-build",
      "ci.yml / unit-tests",
      "e2e.yml / change-scope",
      "e2e.yml / law-pins",
      "rls-session.yml / rls-session",
    ]);
    for (const { where, job: gated } of gatedJobs) {
      const classify = defined(gated.steps.find((entry) => entry.name === CLASSIFY), where);
      expect(classify.id, where).toBe("scope");
      expect(classify.run, where).toBe(CLASSIFY_RUN);
      // The merge commit and its base, or HEAD^1 does not exist.
      const checkout = defined(gated.steps[0], `${where} checkout`);
      expect(checkout.uses ?? "", where).toMatch(/^actions\/checkout@/);
      expect(checkout.with?.["fetch-depth"], where).toBe(2);
      expect(gated.steps.indexOf(classify), where).toBe(1);
    }
  });

  it.each([
    { files: ["docs/CI_RUNBOOK.md"], scope: "docs" },
    { files: ["README.md", "e2e/AGENTS.md", "docs/proof/one/shot.png"], scope: "docs" },
    { files: ["data/freshness_registry.json"], scope: "data" },
    { files: ["public/data/london/venues.slim.json", "public/data/uk-base/cell.geojson"], scope: "data" },
    { files: ["docs/rules/a.md", "data/packs/fsa.json"], scope: "data" },
    { files: ["lib/venues.ts"], scope: "code" },
    { files: ["docs/CI_RUNBOOK.md", "lib/venues.ts"], scope: "code" },
    { files: ["data/venues.csv"], scope: "code" },
    { files: [".github/workflows/ci.yml", "docs/CI_RUNBOOK.md"], scope: "code" },
    { files: ["data-harvest/notes.json"], scope: "code" },
    { files: [], scope: "code" },
  ])("reads $files as $scope", ({ files, scope }) => {
    expect(scopeOf(files)).toBe(scope);
  });

  it("reads a code file renamed into docs as code, by asking real git", () => {
    // Rename detection would print only the new docs path, and a pull request
    // that moves lib/ code under docs/ would skip every heavy job.
    const repo = mkdtempSync(join(scratch, "repo-"));
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    };
    git("init", "-q");
    git("config", "user.email", "ci@example.invalid");
    git("config", "user.name", "ci");
    mkdirSync(join(repo, "lib"));
    writeFileSync(join(repo, "lib/moved.ts"), "export const moved = 1;\n".repeat(20));
    git("add", ".");
    git("commit", "-q", "-m", "base");
    mkdirSync(join(repo, "docs"));
    git("mv", "lib/moved.ts", "docs/moved.md");
    git("commit", "-q", "-m", "move");
    const result = runStep(CLASSIFY_RUN, { EVENT_NAME: "pull_request" }, { cwd: repo, realGit: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toMatch(/^scope=code$/m);
  });

  it("runs in full on every event other than a pull request, without asking git", () => {
    for (const event of ["push", "schedule", "workflow_dispatch"]) {
      // The stand-in git exits 2 on any call, and a docs diff is offered: the
      // classifier must not read it.
      expect(scopeOf(["docs/CI_RUNBOOK.md"], event)).toBe("code");
    }
  });
});

// The job that only classifies, for the macOS layout pins to read.
const SCOPE_JOB = "e2e.yml / change-scope";
const LAYOUT_PIN_JOBS = ["layout-pins-1", "layout-pins-2", "layout-pins-3"];
// Run unless the classifier succeeded and said no screen code changed. A
// failed classifier must run the layout pins, not skip them: a skipped check
// counts as passed for branch protection, so skipping would let a screen
// change merge without them (fail closed). The nightly and a dispatch skip
// them, because the full suite runs every layout spec on the same commit.
const LAYOUT_PIN_IF =
  "${{ !cancelled() && github.event_name != 'schedule' && github.event_name != 'workflow_dispatch' && (needs.change-scope.result != 'success' || needs.change-scope.outputs.layout == 'ui') }}";

describe("what each scope runs", () => {
  it("gates every step after the classifier, and never a whole job", () => {
    for (const { where, job: gated } of gatedJobs) {
      if (where === SCOPE_JOB) continue;
      expect(gated.if ?? "", `${where} must not skip at the job level`).not.toContain("scope");
      const after = gated.steps.slice(gated.steps.findIndex((entry) => entry.name === CLASSIFY) + 1);
      expect(after.length, where).toBeGreaterThan(0);
      for (const entry of after) expect(entry.if ?? "", `${where} / ${entry.name}`).toContain("steps.scope.outputs.scope");
    }
  });

  it("runs the heavy work for code only", () => {
    const codeOnly = "steps.scope.outputs.scope == 'code'";
    expect(step("ci.yml / unit-tests", "Unit tests with coverage").if).toBe(codeOnly);
    expect(step("ci.yml / unit-tests", "Upload coverage blob").if).toBe(codeOnly);
    expect(step("ci.yml / coverage", "Enforce coverage").if).toBe(codeOnly);
    expect(step("ci.yml / production-build", "Build").if).toBe(codeOnly);
    expect(step("e2e.yml / law-pins", "Run law-pinning journeys").if).toBe(codeOnly);
    expect(step("rls-session.yml / rls-session", "Run effective RLS session tests").if).toBe(codeOnly);
    // Lint and the typecheck still run for data: a JSON pack can be imported
    // by TypeScript. Only a docs-only change skips them.
    expect(step("ci.yml / lint-and-types", "Lint").if).toBe("steps.scope.outputs.scope != 'docs'");
    expect(step("ci.yml / lint-and-types", "Typecheck").if).toBe("steps.scope.outputs.scope != 'docs'");
  });

  it("skips the macOS layout pins whole, by fixed name, only for a classified change with no screen code", () => {
    const e2e = defined(workflows.find(({ file }) => file === "e2e.yml")).parsed.jobs as Record<
      string,
      Job & { "runs-on"?: string; needs?: string[]; outputs?: Record<string, string>; strategy?: unknown }
    >;
    const scopeJob = defined(e2e["change-scope"], "change-scope");
    // It only classifies: checkout, then the two classifiers, on Linux.
    expect(scopeJob["runs-on"]).toBe("ubuntu-latest");
    expect(scopeJob.steps.map((entry) => entry.name)).toEqual(["Checkout", CLASSIFY, CLASSIFY_LAYOUT]);
    expect(scopeJob.outputs).toEqual({
      scope: "${{ steps.scope.outputs.scope }}",
      layout: "${{ steps.layout.outputs.layout }}",
    });
    expect(scopeJob.if).toBeUndefined();
    for (const id of LAYOUT_PIN_JOBS) {
      const layout = defined(e2e[id], id);
      expect(layout["runs-on"], id).toBe("macos-latest");
      expect(layout.needs, id).toEqual(["change-scope"]);
      expect(layout.if, id).toBe(LAYOUT_PIN_IF);
      // A matrix job skipped whole reports under its unexpanded name.
      expect(layout.strategy, id).toBeUndefined();
      expect(layout.name ?? "", id).not.toContain("${{");
      // Nothing inside the job asks the scope again.
      for (const entry of layout.steps) expect(entry.if ?? "", `${id} / ${entry.name}`).not.toContain("scope");
    }
  });

  it("keeps the freshness gate, data validation, review scope and Security CI for every change", () => {
    const ci = defined(workflows.find(({ file }) => file === "ci.yml")).parsed.jobs;
    for (const id of ["freshness", "validate-data", "review-scope"]) {
      const entry = defined(ci[id], id);
      expect(entry.steps.some((s) => s.name === CLASSIFY), id).toBe(false);
      for (const s of entry.steps) expect(s.if ?? "", `${id} / ${s.name}`).not.toContain("scope");
    }
    const security = defined(workflows.find(({ file }) => file === "security-ci.yml")).parsed.jobs;
    for (const [id, entry] of Object.entries(security)) {
      expect(entry.steps.some((s) => s.name === CLASSIFY), id).toBe(false);
    }
  });
});

describe("the layout scope", () => {
  const LAYOUT_RUN = defined(step(SCOPE_JOB, CLASSIFY_LAYOUT).run, "layout classifier run");

  function layoutOf(files: string[], eventName = "pull_request"): string {
    const result = runStep(
      LAYOUT_RUN,
      { EVENT_NAME: eventName, FAKE_DIFF: files.join("\n") + (files.length ? "\n" : "") },
    );
    expect(result.status, result.stderr).toBe(0);
    return defined(/^layout=(\w+)$/m.exec(result.output)?.[1], `layout in ${result.output}`);
  }

  it("runs the layout pins when any selected spec changes", () => {
    const e2e = defined(workflows.find(({ file }) => file === "e2e.yml")).parsed;
    const run = defined(defined(e2e.jobs["layout-pins-1"]).steps.find(
      (entry) => entry.name === "Run layout-pinning journeys",
    )?.run);
    const log = join(mkdtempSync(join(scratch, "layout-npx-")), "npx.log");
    const result = runStep(run.replaceAll("${{ env.LAYOUT_SHARD }}", "1"), { NPX_LOG: log });
    expect(result.status, result.stderr).toBe(0);
    const files = readFileSync(log, "utf8").trim().split("\n");
    for (const file of files.filter((word) => word.startsWith("e2e/"))) {
      expect(layoutOf([file]), file).toBe("ui");
    }
  });

  it.each([
    // Screen code and what the pins run with.
    { files: ["components/map/MapCanvas.tsx"], layout: "ui" },
    { files: ["app/(map)/page.tsx"], layout: "ui" },
    { files: ["app/globals.css"], layout: "ui" },
    { files: ["lib/someView.tsx"], layout: "ui" },
    { files: ["public/fonts/x.woff2"], layout: "ui" },
    { files: ["e2e/mobile-map-chrome-fit.spec.ts"], layout: "ui" },
    { files: ["e2e/helpers/mobileMapShell.ts"], layout: "ui" },
    { files: ["e2e/fixtures/venue.json"], layout: "ui" },
    { files: ["e2e/conditional-skips.allowlist.json"], layout: "ui" },
    ...[
      "lib/cities.ts", "lib/cityStoryBands.ts", "lib/contentSecurityPolicy.mjs",
      "lib/deviceAccountSessions.ts", "lib/landingHero.ts", "lib/lateFood.ts",
      "lib/mapCanvasAvailability.ts", "lib/mapBasemapTaste.ts", "lib/mapIcons.ts",
      "lib/donutClusterGeometry.ts", "lib/priceBand.ts", "lib/profileCovers.ts",
      "lib/siteContact.ts", "lib/surfaceDataCache.ts", "lib/ukBasePubSearch.ts",
    ].map((file) => ({ files: [file], layout: "ui" })),
    { files: [".github/workflows/e2e.yml"], layout: "ui" },
    { files: [".github/actions/pubmax-playwright-port/action.yml"], layout: "ui" },
    { files: ["package.json"], layout: "ui" },
    ...["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"]
      .map((file) => ({ files: [file], layout: "ui" })),
    ...["next.config.js", "next.config.mjs", "next.config.ts"]
      .map((file) => ({ files: [file], layout: "ui" })),
    { files: ["playwright.config.ts"], layout: "ui" },
    { files: ["proxy.ts"], layout: "ui" },
    { files: ["__tests__/venues.test.ts", "components/nav/navigationModel.ts"], layout: "ui" },
    { files: ["__tests__/venues.test.ts"], layout: "none" },
    { files: ["e2e/smoke.spec.ts", "e2e/food-menu-discovery.spec.ts"], layout: "ui" },
    { files: ["data/freshness_registry.json", "public/data/london/venues.slim.json"], layout: "none" },
    { files: ["data/venues.csv"], layout: "none" },
    { files: ["docs/CI_RUNBOOK.md", "app/AGENTS.md"], layout: "none" },
    { files: ["lib/venues.ts", "lib/harvest/sourcePolicy.ts"], layout: "ui" },
    ...[
      "app/api/feedback/route.ts", "app/api/city-map-card/route.tsx",
      "app/api/helpers.ts", "app/api/style.css", "app/route.ts", "app/feed/route.ts",
      "app/(feeds)/rss/route.js", "app/(feeds)/rss/route.jsx", "app/(feeds)/rss/route.tsx",
      "scripts/assert-playwright-gate.mjs", "scripts/run-with-restored-next-env.mjs",
      "scripts/copy_maplibre_worker.mjs", "scripts/copy_elevenlabs_worklets.mjs",
      "scripts/ci/install-script-allowlist.mjs", "scripts/lib/uiUxBattleTestBrowser.mjs",
      "scripts/lib/committedBundledDataPaths.mjs", "scripts/build_slim_index.mjs", "scripts/style.css",
    ].map((file) => ({ files: [file], layout: "none" })),
    ...[
      "lib/e2eReviewAuth.ts", "lib/performanceBudgets.ts", "lib/playwrightDistDir.mjs",
      "lib/priceChipLadder.ts", "lib/staticAssetPrefixes.mjs", "lib/webVitalsBaseline.ts",
    ].map((file) => ({ files: [file], layout: "ui" })),
    { files: ["app/api/feedback/route.ts", "components/PriceBadge.tsx"], layout: "ui" },
    { files: ["app/feed/route.ts", "e2e/helpers/mobileMapShell.ts"], layout: "ui" },
    { files: ["supabase/migrations/1_x.sql", "supabase/rollbacks/1_x.sql"], layout: "none" },
    { files: ["supabase/migrations/1_x.sql", ".github/workflows/ci.yml"], layout: "ui" },
    { files: ["supabase/config.toml"], layout: "ui" },
    { files: ["unknown/new-file.txt"], layout: "ui" },
    { files: ["app/route-helper.ts"], layout: "ui" },
    { files: ["data-harvest/notes.json"], layout: "ui" },
    {
      files: [
        "__tests__/venues.test.ts", "data/venues.csv", "public/data/venues.json",
        "docs/CI_RUNBOOK.md", "scripts/build_slim_index.mjs", "app/api/feedback/route.ts",
        "supabase/migrations/1_x.sql",
      ],
      layout: "none",
    },
    { files: ["docs/CI_RUNBOOK.md", "data/venues.csv", "lib/mapBasemapTaste.ts"], layout: "ui" },
    // An empty diff fails closed.
    { files: [], layout: "ui" },
  ])("reads $files as $layout", ({ files, layout }) => {
    expect(layoutOf(files)).toBe(layout);
  });

  it("fails without a skip output when git cannot read the diff", () => {
    const result = runStep(LAYOUT_RUN, {
      EVENT_NAME: "pull_request",
      FAKE_DIFF: "docs/CI_RUNBOOK.md\n",
      FAKE_GIT_STATUS: "2",
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toBe("");
  });

  it("runs every pin on every event other than a pull request, without asking git", () => {
    for (const event of ["push", "schedule", "workflow_dispatch"]) {
      expect(layoutOf(["__tests__/venues.test.ts"], event)).toBe("ui");
    }
  });
});

describe("the unit tests a docs or data change still runs", () => {
  const named = step("ci.yml / unit-tests", NAMED_TESTS);
  const NAMED_RUN = defined(named.run, "named-test run");

  function selected(files: string[]): string[] | null {
    const log = join(mkdtempSync(join(scratch, "npx-")), "npx.log");
    const result = runStep(NAMED_RUN, { FAKE_DIFF: files.join("\n") + "\n", NPX_LOG: log });
    expect(result.status, result.stderr).toBe(0);
    let words: string[];
    try {
      words = readFileSync(log, "utf8").trim().split("\n");
    } catch {
      return null; // npx was never called
    }
    expect(words.slice(0, 2)).toEqual(["vitest", "run"]);
    return words.slice(2);
  }

  it("runs on shard 1 for docs and data only", () => {
    expect(named.if).toBe("steps.scope.outputs.scope != 'code' && matrix.shard == 1");
  });

  it("runs every unit test that names a changed file by path or by file name", () => {
    const tests = selected(["lib/AGENTS.md"]) ?? [];
    expect(tests).toContain("__tests__/agentsMdTree.test.ts");
    expect(tests.every((test) => /^__tests__\/.+\.test\.tsx?$/.test(test))).toBe(true);
    expect(new Set(tests).size).toBe(tests.length);
  });

  it("leaves the PostgreSQL suites to the job that installs a cluster", () => {
    const suite = defined(POSTGRES_BACKED_SUITES[0], "a PostgreSQL suite");
    // The suite names its own path, so a change to it would select it.
    const tests = selected([suite, "lib/AGENTS.md"]) ?? [];
    expect(tests).not.toContain(suite);
    for (const test of tests) expect(POSTGRES_BACKED_SUITES).not.toContain(test);
  });

  it("runs nothing when no unit test names the change", () => {
    // Built at run time, so not even this file names it.
    const unnamed = ["docs/proof/", "zz-unnamed-", String(Date.now()), ".png"].join("");
    expect(selected([unnamed])).toBeNull();
  });
});
