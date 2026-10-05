import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { PERF_AB_JOB_WALL_MS } from "@/lib/performanceAbEvidence";
import { ciJobs, jobStep, unitShards } from "@/__tests__/helpers/ciWorkflow";
import { defined } from "@/__tests__/helpers/defined";

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
      job = defined(jobHeader[1]);
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
    if (inEnv && !["name", "run", "uses", "with", "if", "env", "id"].includes(defined(key))) {
      step.env[defined(key)] = defined(value).replace(/^"|"$/g, "");
      continue;
    }
    inEnv = key === "env";
    if (key === "name") step.name = defined(value);
    if (key === "run") {
      step.run = value === ">-" || value === "|" ? "" : defined(value);
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
      job = defined(jobHeader[1]);
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
    const checkouts = workflow.match(/uses: actions\/checkout@[0-9a-f]{40} # v\S+/g) ?? [];
    const protectedCheckouts =
      workflow.match(
        /uses: actions\/checkout@[0-9a-f]{40} # v\S+\n\s+with:\n\s+persist-credentials: false/g,
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
        /npm run build(?!:)|next build|npm run typecheck|node_modules\/typescript\/bin\/tsc|playwright test|scripts\/perf-ab\.mjs/.test(
          step.run,
        ),
    );

    expect(needsHeap.length).toBeGreaterThan(0);
    for (const step of needsHeap) {
      expect(step.env.NODE_OPTIONS ?? "", `${step.job} / ${step.name}`).toContain(HEAP);
    }
    expect(needsHeap.map((step) => step.name)).toContain("Tell a red route apart from a slow box");
    expect(needsHeap.map((step) => step.name)).toContain("Typecheck");
    expect(needsHeap.map((step) => step.name)).toContain("Typecheck (TypeScript 6)");
  });

  it("holds the A/B's mirrored wall to the Performance budget job's own timeout", () => {
    // The A/B measures on what is LEFT of this wall so the artifact step still
    // runs. Three numbers that must move together are held together here rather
    // than by a comment asking the next person to remember: the job's timeout,
    // the figure handed to the script, and the module's own mirror.
    const wallMinutes = defined(parseJobWalls(performanceWorkflow)["performance-budget"]);
    expect(wallMinutes).toBe(PERF_AB_JOB_WALL_MS / 60_000);

    const abStep = steps.find((step) => step.name === "Tell a red route apart from a slow box");
    expect(abStep?.env.PUBMAX_PERF_AB_JOB_WALL_MS).toBe(String(wallMinutes * 60_000));
  });

  it("records the job's start before anything can spend the wall", () => {
    const [first] = steps.filter((step) => step.job === "performance-budget");
    expect(defined(first).run).toContain("PUBMAX_PERF_AB_JOB_STARTED_MS");
    expect(defined(first).run).toContain("GITHUB_ENV");
  });

  it("does not let the freshness calendar skip the build, unit shards or coverage", () => {
    const needs = parseJobNeeds(workflow);
    for (const job of ["production-build", "unit-tests", "coverage"]) {
      expect(jobAncestors(job, needs).has("freshness"), job).toBe(false);
    }
    expect(needs["production-build"]).toEqual(["lint-and-types"]);
    expect(needs.coverage).toEqual(["unit-tests"]);
    expect(needs.freshness).toEqual([]);
    expect(needs["validate-data"]).toEqual([]);
  });

  it("validates every bundled dataset in its own job", () => {
    const validation = steps.filter((step) => step.job === "validate-data");
    const runs = validation.map((step) => step.run);
    const validate = validation.find((step) => step.run === "npm run validate-data");
    expect(validate?.env.PUBMAX_VERIFY_COMMITTED_DATA).toBe("1");
    expect(runs.indexOf("npm run build:venue-details")).toBeGreaterThan(-1);
    expect(runs.indexOf("npm run build:venue-details")).toBeLessThan(
      runs.indexOf("npm run validate-data"),
    );
    const { jobs } = parse(workflow) as { jobs: Record<string, { name?: string }> };
    expect(jobs["validate-data"]?.name).toBe("Data validation");
  });

  it("starts the unit shards at once and in parallel", () => {
    // The shards build their own slim data and read nothing lint or the
    // production build make, so waiting on them only lengthens the path.
    expect(parseJobNeeds(workflow)["unit-tests"]).toEqual([]);
    expect(ciJobs()["unit-tests"]?.strategy?.["max-parallel"]).toBeUndefined();
  });

  it("gates coverage on the merged shards and freshness independently", () => {
    // Each shard collects coverage for its half and writes a blob. A half
    // cannot meet the whole-suite thresholds, so a shard turns them off and
    // the Coverage job enforces them over the merged blobs. The suite runs
    // once per CI run, not once in the shards and again for coverage.
    const shards = unitShards();
    expect(shards.map(({ shard }) => shard)).toEqual([1, 2]);
    for (const { shard, total, words, env } of shards) {
      expect(words.slice(0, 4), `shard ${shard}`).toEqual(["npm", "run", "coverage", "--"]);
      expect(words.slice(4), `shard ${shard}`).toEqual(
        expect.arrayContaining([
          `--shard=${shard}/${total}`,
          "--coverage.thresholds.statements=0",
          "--coverage.thresholds.branches=0",
          "--coverage.thresholds.functions=0",
          "--coverage.thresholds.lines=0",
          "--reporter=blob",
          `--outputFile.blob=blob-reports/blob-${shard}.json`,
        ]),
      );
      expect(env.PUBMAX_RLS_NO_PG, `shard ${shard}`).toBe("1");
    }

    // The Coverage name is the required check branch protection reads.
    const coverage = defined(ciJobs().coverage, "coverage job");
    expect(coverage.name).toBe("Coverage");
    expect(jobStep(coverage, "Download coverage blobs").with?.path).toBe("blob-reports");
    const merge = defined(jobStep(coverage, "Enforce coverage").run, "merge run").trim().split(/\s+/);
    expect(merge).toEqual(["npx", "vitest", "--merge-reports=blob-reports", "--coverage"]);
    const coverageWords = (coverage.steps ?? []).flatMap((step) => step.run?.trim().split(/\s+/) ?? []);
    expect(coverageWords.filter((word) => word.startsWith("--coverage.thresholds"))).toEqual([]);
    expect(workflow).toMatch(
      /freshness:[\s\S]*name: Freshness release gate[\s\S]*npm run check:freshness -- --artifacts-only[\s\S]*node scripts\/check-production-store-freshness\.mjs/,
    );
  });
});
