import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { PERF_AB_JOB_WALL_MS } from "@/lib/performanceAbEvidence";
import { ciJobs, jobStep, unitShards } from "@/__tests__/helpers/ciWorkflow";
import { defined } from "@/__tests__/helpers/defined";

const HEAP = "--max-old-space-size=6144";

type WorkflowStep = { job: string; name: string; run: string; env: Record<string, string> };

function parseSteps(source: string): WorkflowStep[] {
  const { jobs } = parse(source) as {
    jobs: Record<string, { steps?: { name?: string; run?: string; env?: Record<string, string> }[] }>;
  };
  return Object.entries(jobs).flatMap(([job, { steps = [] }]) =>
    steps.map(({ name = "", run = "", env = {} }) => ({ job, name, run, env })),
  );
}

function parseJobNeeds(source: string): Record<string, string[]> {
  const { jobs } = parse(source) as { jobs: Record<string, { needs?: string | string[] }> };
  return Object.fromEntries(Object.entries(jobs).map(([id, { needs }]) =>
    [id, needs === undefined ? [] : Array.isArray(needs) ? needs : [needs]],
  ));
}

function parseJobWalls(source: string): Record<string, number> {
  const { jobs } = parse(source) as { jobs: Record<string, { "timeout-minutes": number }> };
  return Object.fromEntries(Object.entries(jobs).map(([id, job]) => [id, job["timeout-minutes"]]));
}

function runStepOutput(run: string, outputVariable: string): Record<string, string> {
  const scratch = mkdtempSync(join(tmpdir(), "pubmax-release-workflow-"));
  const output = join(scratch, "output");
  try {
    writeFileSync(output, "");
    execFileSync("bash", ["-e", "-c", run], {
      env: { ...process.env, [outputVariable]: output },
    });
    return Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map((line) => {
      const equals = line.indexOf("=");
      return [line.slice(0, equals), line.slice(equals + 1)];
    }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe("clean-main CI release gate", () => {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  const performanceWorkflow = readFileSync(
    join(process.cwd(), ".github/workflows/performance.yml"),
    "utf8",
  );
  const steps = [...parseSteps(workflow), ...parseSteps(performanceWorkflow)];

  it("runs a dedicated production build", () => {
    const build = defined(ciJobs()["production-build"], "production-build job");
    expect(build.name).toBe("Production build");
    expect(jobStep(build, "Build").run?.trim()).toBe("npm run build");
  });

  it("does not persist the workflow token in build checkouts", () => {
    const checkouts = Object.values(ciJobs()).flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const checkout of checkouts) expect(checkout.with?.["persist-credentials"]).toBe(false);
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
    const before = Math.floor(Date.now() / 1000) * 1000;
    const output = runStepOutput(defined(first).run, "GITHUB_ENV");
    const started = Number(output.PUBMAX_PERF_AB_JOB_STARTED_MS);
    expect(started).toBeGreaterThanOrEqual(before);
    expect(started).toBeLessThanOrEqual(Date.now());
  });

  it("starts the build, unit shards, data validation and TypeScript 6 check on their own", () => {
    const needs = parseJobNeeds(workflow);
    // The build starts beside lint (captain, 2 Nov 2026): it reads nothing
    // lint makes, and waiting put the two end to end on the slowest chain.
    expect(needs["production-build"]).toEqual([]);
    expect(needs.coverage).toEqual(["unit-tests"]);
    // The merge queue proof runs only on a main push, so on a pull request
    // these jobs still start at once.
    expect(needs["validate-data"]).toEqual(["queue-proof"]);
    expect(needs["typecheck-ts6"]).toEqual(["queue-proof"]);
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

  it("restores the Next.js build cache, and only a main push saves one, at most once a day", () => {
    // Next keeps Turbopack's build work in .next/cache. Without a restore
    // every CI build is cold; a pull request that saved its own copy would
    // fill the repository's cache space and could write a cache main reads.
    // A cache of about 500 MB saved on every main push (12 to 32 a day) could
    // also crowd the nightly Tavily cursor out of the 10 GB, so the key ends
    // in the UTC date and an exact hit saves nothing.
    const build = defined(ciJobs()["production-build"], "production-build job");
    const names = (build.steps ?? []).map((step) => step.name);
    const restore = jobStep(build, "Restore the Next.js build cache");
    const save = jobStep(build, "Save the Next.js build cache");
    expect(names.indexOf(restore.name)).toBeLessThan(names.indexOf("Build"));
    expect(names.indexOf(save.name)).toBeGreaterThan(names.indexOf("Build"));
    expect(restore.uses).toMatch(/^actions\/cache\/restore@[0-9a-f]{40}$/);
    expect(save.uses).toMatch(/^actions\/cache\/save@[0-9a-f]{40}$/);
    for (const step of [restore, save]) expect(step.with?.path, step.name).toBe(".next/cache");
    expect(save.with?.key).toBe(restore.with?.key);
    expect(String(restore.with?.key)).toContain("hashFiles('package-lock.json')");
    expect(String(restore.with?.key)).toMatch(/\$\{\{ steps\.cache-day\.outputs\.day \}\}$/);
    expect(String(restore.with?.key)).not.toContain("github.sha");
    const day = jobStep(build, "Name the build cache for today");
    expect(names.indexOf(day.name)).toBeLessThan(names.indexOf(restore.name));
    const before = new Date().toISOString().slice(0, 10);
    const output = runStepOutput(defined(day.run), "GITHUB_OUTPUT");
    const after = new Date().toISOString().slice(0, 10);
    expect([before, after]).toContain(output.day);
    expect(String(restore.with?.["restore-keys"])).toContain("hashFiles('package-lock.json')");
    expect(restore.if).toBe("steps.scope.outputs.scope == 'code'");
    expect(save.if).toBe(
      "steps.scope.outputs.scope == 'code' && github.event_name == 'push' && github.ref == 'refs/heads/main' && steps.build-cache.outputs.cache-hit != 'true'",
    );
  });

  it("skips the CI build's own type check only where a wider check already ran", () => {
    // next build type-checks tsconfig.build.json with TypeScript 6. The
    // Typecheck (TypeScript 6) job runs the same compiler over tsconfig.json, so the CI
    // build skips its copy. This holds only while tsconfig.json covers every
    // file tsconfig.build.json does, with the same compiler options.
    const build = defined(ciJobs()["production-build"], "production-build job");
    expect(jobStep(build, "Build").env?.PUBMAX_CI_SKIP_BUILD_TYPECHECK).toBe("1");
    // The wider check is its own required job, beside lint (captain, 2 Nov 2026).
    const ts6 = defined(ciJobs()["typecheck-ts6"], "typecheck-ts6 job");
    expect(ts6.name).toBe("Typecheck (TypeScript 6)");
    const names = (ts6.steps ?? []).map((step) => step.name);
    expect(names.indexOf("Generate the route types")).toBeLessThan(names.indexOf("Typecheck (TypeScript 6)"));
    expect(jobStep(ts6, "Generate the route types").run?.trim()).toBe("npx next typegen");
    expect(jobStep(ts6, "Typecheck (TypeScript 6)").run?.trim()).toBe(
      "node node_modules/typescript/bin/tsc --noEmit",
    );
    expect(jobStep(ts6, "Typecheck (TypeScript 6)").if).toBe("steps.scope.outputs.scope != 'docs'");
    const lint = defined(ciJobs()["lint-and-types"], "lint-and-types job");
    expect((lint.steps ?? []).map((step) => step.name)).not.toContain("Typecheck (TypeScript 6)");

    const readJson = (file: string) =>
      JSON.parse(readFileSync(join(process.cwd(), file), "utf8")) as {
        extends?: string;
        compilerOptions?: unknown;
        include?: string[];
      };
    const buildConfig = readJson("tsconfig.build.json");
    expect(buildConfig.extends).toBe("./tsconfig.json");
    expect(buildConfig.compilerOptions).toBeUndefined();
    // Compare what TypeScript itself resolves, not the include lists: an
    // exclude added to tsconfig.json alone would otherwise drop app files
    // from the wider check without a word.
    const resolved = (file: string) =>
      JSON.parse(
        execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--showConfig", "-p", file], {
          cwd: process.cwd(),
          encoding: "utf8",
        }),
      ) as { files?: string[]; compilerOptions?: unknown };
    const fullResolved = resolved("tsconfig.json");
    const buildResolved = resolved("tsconfig.build.json");
    const fullFiles = new Set(fullResolved.files ?? []);
    const uncovered = (buildResolved.files ?? []).filter((file) => !fullFiles.has(file));
    expect(buildResolved.files?.length ?? 0).toBeGreaterThan(0);
    expect(uncovered).toEqual([]);
    expect(buildResolved.compilerOptions).toEqual(fullResolved.compilerOptions);

    // A Vercel dashboard variable reaches Vercel builds too, so the skip is
    // refused on Vercel and a deploy build always type-checks.
    for (const [skip, vercel, expected] of [
      ["", "", false],
      ["1", "", true],
      ["", "1", false],
      ["1", "1", false],
    ] as const) {
      const output = execFileSync(process.execPath, ["--input-type=module", "-e",
        'import config from "./next.config.mjs"; console.log(JSON.stringify(config.typescript.ignoreBuildErrors));',
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, PUBMAX_CI_SKIP_BUILD_TYPECHECK: skip, VERCEL: vercel },
      });
      expect(JSON.parse(output.trim()), `skip=${skip}, VERCEL=${vercel}`).toBe(expected);
    }
  });

  it("starts the unit shards at once and in parallel", () => {
    // The shards build their own slim data and read nothing lint or the
    // production build make, so waiting on them only lengthens the path.
    expect(parseJobNeeds(workflow)["unit-tests"]).toEqual(["queue-proof"]);
    expect(ciJobs()["unit-tests"]?.strategy?.["max-parallel"]).toBeUndefined();
  });

  it("gates coverage on the merged shards", () => {
    // Each of the three shards (captain, 2 Nov 2026) collects coverage for
    // its third and writes a blob. A third cannot meet the whole-suite
    // thresholds, so a shard turns them off and the Coverage job enforces
    // them over the merged blobs. The suite runs once per CI run, not once in
    // the shards and again for coverage.
    const shards = unitShards();
    expect(shards.map(({ shard }) => shard)).toEqual([1, 2, 3]);
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

    // The CI check needs Coverage by its job id; the name is what a reader sees.
    const coverage = defined(ciJobs().coverage, "coverage job");
    expect(coverage.name).toBe("Coverage");
    expect(jobStep(coverage, "Download coverage blobs").with?.path).toBe("blob-reports");
    const merge = defined(jobStep(coverage, "Enforce coverage").run, "merge run").trim().split(/\s+/);
    expect(merge).toEqual(["npx", "vitest", "--merge-reports=blob-reports", "--coverage"]);
    const coverageWords = (coverage.steps ?? []).flatMap((step) => step.run?.trim().split(/\s+/) ?? []);
    expect(coverageWords.filter((word) => word.startsWith("--coverage.thresholds"))).toEqual([]);
  });
});
