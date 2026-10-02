import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { PERF_AB_JOB_WALL_MS } from "@/lib/performanceAbEvidence";

const HEAP = "--max-old-space-size=6144";

type WorkflowStep = { job: string; name: string; run: string; env: Record<string, string> };

/**
 * The workflow's steps as GitHub reads them: which job, which step, what it
 * runs and what environment it declares.
 *
 * Counting matches of a string over the file cannot say WHICH step carries the
 * heap, so a heap moved off the merge-base build onto an unrelated step keeps
 * the count and loses the build.
 */
function parseSteps(yaml: string): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  let job = "";
  let step: WorkflowStep | null = null;
  let block: { key: "run"; indent: number } | null = null;
  let inEnv = false;
  for (const line of yaml.split("\n")) {
    const indent = line.length - line.trimStart().length;
    const text = line.trim();

    if (block && line.trim() !== "" && indent > block.indent) {
      if (step) step.run = `${step.run}\n${text}`;
      continue;
    }
    if (block) block = null;

    const jobHeader = /^ {2}([A-Za-z0-9_-]+):$/.exec(line);
    if (jobHeader) {
      job = jobHeader[1];
      step = null;
      inEnv = false;
      continue;
    }
    if (/^\s*- /.test(line) && indent >= 4) {
      step = { job, name: "", run: "", env: {} };
      steps.push(step);
      inEnv = false;
    }
    if (!step) continue;

    const entry = /^\s*(?:- )?([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (!entry) continue;
    const [, key, value] = entry;
    if (inEnv && !["name", "run", "uses", "with", "if", "env", "id"].includes(key)) {
      step.env[key] = value.replace(/^"|"$/g, "");
      continue;
    }
    inEnv = key === "env";
    if (key === "name") step.name = value;
    if (key === "run") {
      step.run = value === ">-" || value === "|" ? "" : value;
      if (value === ">-" || value === "|") block = { key: "run", indent };
    }
  }
  return steps;
}

/**
 * Each job's `needs` list, as GitHub reads it. A job with no needs starts on
 * its own. The scalar, flow and block forms all parse to the same list.
 */
function parseJobNeeds(yaml: string): Record<string, string[]> {
  const { jobs } = parse(yaml) as { jobs: Record<string, { needs?: string | string[] }> };
  return Object.fromEntries(
    Object.entries(jobs).map(([job, { needs }]) => [
      job,
      needs === undefined ? [] : Array.isArray(needs) ? needs : [needs],
    ]),
  );
}

function jobAncestors(job: string, needs: Record<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const walk = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of needs[name] ?? []) walk(dep);
  };
  walk(job);
  return seen;
}

/** Each job's own wall, in minutes, as GitHub reads it. */
function parseJobWalls(yaml: string): Record<string, number> {
  const walls: Record<string, number> = {};
  let job = "";
  for (const line of yaml.split("\n")) {
    const jobHeader = /^ {2}([A-Za-z0-9_-]+):$/.exec(line);
    if (jobHeader) {
      job = jobHeader[1];
      continue;
    }
    const wall = /^ {4}timeout-minutes: (\d+)$/.exec(line);
    if (wall && job) walls[job] = Number(wall[1]);
  }
  return walls;
}

describe("clean-main CI release gate", () => {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  const performanceWorkflow = readFileSync(
    join(process.cwd(), ".github/workflows/performance.yml"),
    "utf8",
  );
  const steps = [...parseSteps(workflow), ...parseSteps(performanceWorkflow)];

  it("runs a dedicated production build", () => {
    expect(workflow).toContain("name: Production build");
    expect(workflow).toMatch(/production-build:[\s\S]*run: npm run build/);
  });

  it("does not persist the workflow token in build checkouts", () => {
    const checkouts = workflow.match(/uses: actions\/checkout@v4/g) ?? [];
    const protectedCheckouts =
      workflow.match(
        /uses: actions\/checkout@v4\n\s+with:\n\s+persist-credentials: false/g,
      ) ?? [];

    expect(checkouts.length).toBeGreaterThan(0);
    expect(protectedCheckouts).toHaveLength(checkouts.length);
  });

  it("gives every step that builds or typechecks enough heap", () => {
    // A step that runs a production build, the typecheck or a Playwright suite
    // that builds its own server needs the heap. The interleaved A/B is one of
    // them: it builds the merge base in a worktree.
    const needsHeap = steps.filter(
      (step) =>
        /npm run build|next build|npx tsc --noEmit|playwright test|scripts\/perf-ab\.mjs/.test(
          step.run,
        ) && !/npm run build:slim/.test(step.run),
    );

    expect(needsHeap.length).toBeGreaterThan(0);
    for (const step of needsHeap) {
      expect(step.env.NODE_OPTIONS ?? "", `${step.job} / ${step.name}`).toContain(HEAP);
    }
    expect(needsHeap.map((step) => step.name)).toContain("Tell a red route apart from a slow box");
    expect(needsHeap.map((step) => step.name)).toContain("Typecheck");
  });

  it("holds the A/B's mirrored wall to the Performance budget job's own timeout", () => {
    // The A/B measures on what is LEFT of this wall so the artifact step still
    // runs. Three numbers that must move together are held together here rather
    // than by a comment asking the next person to remember: the job's timeout,
    // the figure handed to the script, and the module's own mirror.
    const wallMinutes = parseJobWalls(performanceWorkflow)["performance-budget"];
    expect(wallMinutes).toBe(PERF_AB_JOB_WALL_MS / 60_000);

    const abStep = steps.find((step) => step.name === "Tell a red route apart from a slow box");
    expect(abStep?.env.PUBMAX_PERF_AB_JOB_WALL_MS).toBe(String(wallMinutes * 60_000));
  });

  it("records the job's start before anything can spend the wall", () => {
    const [first] = steps.filter((step) => step.job === "performance-budget");
    expect(first.run).toContain("PUBMAX_PERF_AB_JOB_STARTED_MS");
    expect(first.run).toContain("GITHUB_ENV");
  });

  it("does not let the freshness calendar skip the build, unit shards or coverage", () => {
    const needs = parseJobNeeds(workflow);
    for (const job of ["production-build", "unit-tests", "coverage"]) {
      expect(jobAncestors(job, needs).has("freshness"), job).toBe(false);
    }
    expect(needs["production-build"]).toEqual(["lint-and-types"]);
    expect(needs["unit-tests"]).toEqual(["production-build"]);
    expect(needs.coverage).toEqual(["unit-tests"]);
    expect(needs.freshness).toEqual([]);
  });

  it("gates coverage and freshness independently", () => {
    expect(workflow).toMatch(/coverage:[\s\S]*name: Coverage[\s\S]*run: >-[\s\S]*npm run coverage/);
    // The clusterless jobs exclude exactly the closed list in
    // scripts/rls/postgresSuites.mjs, never a `*Migration*` glob: that glob
    // both dropped source-text migration tests nobody needed to skip AND let
    // three new `*MigrationEffective` proofs run in a job with no PostgreSQL,
    // where they printed a skip banner and left the job green.
    // __tests__/postgresSuiteInventory.test.ts holds the two lists together.
    expect(workflow).toMatch(
      /coverage:[\s\S]*PUBMAX_RLS_NO_PG: "1"[\s\S]*--exclude '__tests__\/permissionMatrixEffective\.test\.ts'/,
    );
    expect(workflow).not.toMatch(/--exclude '__tests__\/\*\*\/\*Migration\.test\.ts'/);
    expect(workflow).toMatch(
      /freshness:[\s\S]*name: Freshness release gate[\s\S]*npm run check:freshness -- --artifacts-only[\s\S]*node scripts\/check-production-store-freshness\.mjs/,
    );
  });
});
