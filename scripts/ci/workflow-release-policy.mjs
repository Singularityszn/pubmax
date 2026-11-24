import assert from "node:assert/strict";
import { PERF_AB_JOB_WALL_MS } from "../../lib/performanceAbEvidence.ts";
import { browserJobCondition, browserJobName } from "./githubExpressions.ts";

export const REQUIRED_CHECKS = {
  "ci.yml": "CI check", "e2e.yml": "Browser tests check", "rls-session.yml": "RLS session check",
  "security-ci.yml": "Security CI check", "freshness.yml": "Freshness check",
};
const needsOf = (job) => job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
const step = (job, name) => {
  const found = job.steps?.find((entry) => entry.name === name);
  assert(found, `missing step ${name}`);
  return found;
};

export function releasePolicy(workflows, check) {
  const all = Object.fromEntries(workflows.map(({ file, parsed }) => [file, parsed]));
  const ci = all["ci.yml"]?.jobs;
  if (ci) {
    check("ci.yml", "release build and independent checks", () => {
      assert.equal(ci["production-build"].name, "Production build");
      assert.equal(step(ci["production-build"], "Build").run.trim(), "npm run build");
      assert.deepEqual(needsOf(ci["production-build"]), []);
      assert.deepEqual(needsOf(ci.coverage), ["unit-tests"]);
      for (const id of ["validate-data", "typecheck-ts6", "unit-tests"]) assert.deepEqual(needsOf(ci[id]), ["queue-proof"]);
      assert.equal(ci["unit-tests"].strategy?.["max-parallel"], undefined);
      assert.equal(step(ci["production-build"], "Build").env?.PUBMAX_CI_SKIP_BUILD_TYPECHECK, "1");
      assert.equal(ci["typecheck-ts6"].name, "Typecheck (TypeScript 6)");
      const ts6 = ci["typecheck-ts6"];
      assert(ts6.steps.indexOf(step(ts6, "Generate the route types")) < ts6.steps.indexOf(step(ts6, "Typecheck (TypeScript 6)")));
      assert.equal(step(ts6, "Generate the route types").run.trim(), "npx next typegen");
      assert.equal(step(ts6, "Typecheck (TypeScript 6)").run.trim(), "node node_modules/typescript/bin/tsc --noEmit");
      assert.equal(step(ts6, "Typecheck (TypeScript 6)").if, "steps.scope.outputs.scope != 'docs'");
      assert(!ci["lint-and-types"].steps.some((entry) => entry.name === "Typecheck (TypeScript 6)"));
    });
    check("ci.yml / validate-data", "build details before validating committed data", () => {
      const job = ci["validate-data"];
      const runs = job.steps.map((entry) => entry.run);
      const validate = job.steps.find((entry) => entry.run === "npm run validate-data");
      assert.equal(validate?.env?.PUBMAX_VERIFY_COMMITTED_DATA, "1");
      assert(runs.indexOf("npm run build:venue-details") >= 0);
      assert(runs.indexOf("npm run build:venue-details") < runs.indexOf("npm run validate-data"));
      assert.equal(job.name, "Data validation");
    });
    check("ci.yml / production-build", "restore the build cache and save only the first main build each day", () => {
      const job = ci["production-build"];
      const restore = step(job, "Restore the Next.js build cache");
      const save = step(job, "Save the Next.js build cache");
      assert(job.steps.indexOf(restore) < job.steps.indexOf(step(job, "Build")));
      assert(job.steps.indexOf(save) > job.steps.indexOf(step(job, "Build")));
      assert(job.steps.indexOf(step(job, "Name the build cache for today")) < job.steps.indexOf(restore));
      assert.match(restore.uses, /^actions\/cache\/restore@[0-9a-f]{40}$/);
      assert.match(save.uses, /^actions\/cache\/save@[0-9a-f]{40}$/);
      for (const entry of [restore, save]) assert.equal(entry.with?.path, ".next/cache");
      assert.equal(save.with?.key, restore.with?.key);
      assert(String(restore.with?.key).includes("hashFiles('package-lock.json')"));
      assert.match(String(restore.with?.key), /\$\{\{ steps\.cache-day\.outputs\.day \}\}$/);
      assert(!String(restore.with?.key).includes("github.sha"));
      assert(String(restore.with?.["restore-keys"]).includes("hashFiles('package-lock.json')"));
      assert.equal(restore.if, "steps.scope.outputs.scope == 'code'");
      assert.equal(save.if, "steps.scope.outputs.scope == 'code' && github.event_name == 'push' && github.ref == 'refs/heads/main' && steps.build-cache.outputs.cache-hit != 'true'");
    });
    check("ci.yml / coverage", "merge coverage from every unit shard without weakening the final thresholds", () => {
      const job = ci["unit-tests"];
      const run = step(job, "Unit tests with coverage");
      assert.equal(all["ci.yml"].on.pull_request, null);
      assert(!run.run.split(/\s+/).some((word) => word === "related" || word.startsWith("--changed")));
      assert.deepEqual(job.strategy?.matrix?.shard, [1, 2, 3]);
      for (const shard of job.strategy.matrix.shard) {
        const words = run.run.replaceAll("${{ matrix.shard }}", String(shard)).trim().split(/\s+/);
        assert.deepEqual(words.slice(0, 4), ["npm", "run", "coverage", "--"]);
        for (const word of [`--shard=${shard}/3`, "--coverage.thresholds.statements=0", "--coverage.thresholds.branches=0", "--coverage.thresholds.functions=0", "--coverage.thresholds.lines=0", "--reporter=blob", `--outputFile.blob=blob-reports/blob-${shard}.json`]) assert(words.includes(word));
        assert.equal(run.env?.PUBMAX_RLS_NO_PG, "1");
      }
      assert.equal(ci.coverage.name, "Coverage");
      assert.equal(step(ci.coverage, "Download coverage blobs").with?.path, "blob-reports");
      assert.deepEqual(step(ci.coverage, "Enforce coverage").run.trim().split(/\s+/), ["npx", "vitest", "--merge-reports=blob-reports", "--coverage"]);
      assert(!ci.coverage.steps.some((entry) => /--coverage\.thresholds/.test(entry.run ?? "")));
    });
  }
  const heapSteps = ["ci.yml", "performance.yml"].flatMap((file) => Object.entries(all[file]?.jobs ?? {}).flatMap(([job, value]) =>
    (value.steps ?? []).map((entry) => ({ file, job, ...entry }))));
  check("ci.yml / performance.yml", "build and typecheck heap", () => {
    const needsHeap = heapSteps.filter((entry) => /npm run build(?!:)|next build|npm run typecheck|node_modules\/typescript\/bin\/tsc|playwright test|scripts\/perf-ab\.mjs/.test(entry.run ?? ""));
    assert(needsHeap.length > 0);
    for (const entry of needsHeap) assert(String(entry.env?.NODE_OPTIONS ?? "").includes("--max-old-space-size=6144"), `${entry.file} / ${entry.job} / ${entry.name}`);
    for (const name of ["Tell a red route apart from a slow box", "Typecheck", "Typecheck (TypeScript 6)"]) assert(needsHeap.some((entry) => entry.name === name));
    const wall = all["performance.yml"].jobs["performance-budget"]["timeout-minutes"];
    assert.equal(wall * 60_000, PERF_AB_JOB_WALL_MS);
    assert.equal(heapSteps.find((entry) => entry.name === "Tell a red route apart from a slow box")?.env?.PUBMAX_PERF_AB_JOB_WALL_MS, String(wall * 60_000));
  });
  const names = Object.keys(REQUIRED_CHECKS).flatMap((file) => Object.values(all[file]?.jobs ?? {}).map((job) => browserJobName(job.name)));
  for (const [file, name] of Object.entries(REQUIRED_CHECKS)) {
    check(file, "required summary covers every pull request job and always reports", () => {
      const { jobs } = all[file];
      const summary = jobs.check;
      assert.equal(browserJobName(summary.name), name);
      assert.equal(names.filter((entry) => entry === name).length, 1);
      const omitted = file === "e2e.yml" ? ["full-suite", "full-suite-gl", "nightly-failure-issue"] : [];
      const needs = needsOf(summary);
      assert.deepEqual([...needs].sort(), Object.keys(jobs).filter((id) => id !== "check" && !omitted.includes(id)).sort());
      for (const dependency of needs) {
        for (const upstream of needsOf(jobs[dependency])) assert(needs.includes(upstream));
        for (const result of ["success", "failure", "cancelled", "skipped"]) {
          assert.equal(browserJobCondition(summary.if, { results: needs.map((id) => id === dependency ? result : "success"), cancelled: result === "cancelled" }), true);
        }
      }
      assert.equal(summary["timeout-minutes"], 5);
      assert.deepEqual(summary.steps?.map((entry) => entry.uses).filter(Boolean), []);
      assert.deepEqual(summary.steps, all["ci.yml"].jobs.check.steps);
    });
    if (file !== "freshness.yml") {
      check(file, "queue proof is read-only and runs on pushes only", () => {
        const proof = all[file].jobs["queue-proof"];
        assert.equal(proof.if, "github.event_name == 'push'");
        assert.deepEqual(proof.permissions, { actions: "read" });
        assert.deepEqual(proof.outputs, { passed: "${{ steps.proof.outputs.passed }}" });
      });
    }
  }
}
