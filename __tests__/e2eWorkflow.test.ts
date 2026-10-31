import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { defined } from "@/__tests__/helpers/defined";

type WorkflowStep = {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type WorkflowJob = {
  name?: string;
  if?: string;
  needs?: string[];
  "runs-on"?: string;
  env?: Record<string, string | number>;
  steps: WorkflowStep[];
  strategy?: { matrix?: { shard?: number[] } };
};
type Workflow = {
  on: Record<string, unknown>;
  env?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
};

// The layout pins are three named jobs that share one step list, not a matrix.
const LAYOUT_PIN_JOBS = ["layout-pins-1", "layout-pins-2", "layout-pins-3"];
// Run unless the classifier succeeded and said no screen code changed. A failed
// classifier must run the layout pins, not skip them: a skipped check counts
// as passed for branch protection, so skipping would let a screen change merge
// without them (fail closed).
const LAYOUT_PIN_IF =
  "${{ !cancelled() && (needs.change-scope.result != 'success' || needs.change-scope.outputs.layout == 'ui') }}";

// A `${{ ... }}` expression is one word even though it holds spaces.
function runWords(run: string | undefined): string[] {
  return run?.match(/(?:\$\{\{[^}]*\}\}|\S)+/g) ?? [];
}

function playwrightSteps(job: WorkflowJob): WorkflowStep[] {
  return job.steps.filter((step) => step.run?.includes("npx playwright test"));
}

describe("browser CI policy", () => {
  const workflowPath = join(process.cwd(), ".github", "workflows", "e2e.yml");

  it("runs a bounded law-pinning browser suite on pull requests and main", () => {
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    expect(Object.keys(workflow.on)).toContain("pull_request");
    const lawPinsJob = defined(workflow.jobs["law-pins"]);
    expect(lawPinsJob.if).toBeUndefined();
    const [testStep, ...extraTestSteps] = playwrightSteps(lawPinsJob);
    expect(extraTestSteps).toEqual([]);
    const run = runWords(defined(testStep, "law-pins Playwright step").run);
    for (const spec of [
      "e2e/smoke.spec.ts",
      "e2e/map-surface-history.spec.ts",
      "e2e/ux-click-recovery.spec.ts",
      "e2e/seo-audit-discovery.spec.ts",
    ]) {
      expect(run).toContain(spec);
    }
    expect(run).toContain("--project=chromium");
  });

  it("keeps the exhaustive browser matrix on nightly and manual runs", () => {
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    expect(workflow.on.schedule).toEqual([
      expect.objectContaining({ cron: expect.any(String) }),
    ]);
    expect(Object.keys(workflow.on)).toContain("workflow_dispatch");
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    const fullSuiteJob = defined(workflow.jobs["full-suite"], "full-suite job");
    expect(fullSuiteJob.if).toBe(
      "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    );
    const shards = fullSuiteJob.strategy?.matrix?.shard;
    expect(shards).toEqual([1, 2, 3, 4]);
    const shardFlags = playwrightSteps(fullSuiteJob).flatMap((step) =>
      runWords(step.run).filter((word) => word.startsWith("--shard=")),
    );
    expect(shardFlags).toEqual([
      `--shard=\${{ matrix.shard }}/${shards?.length}`,
    ]);
  });

  it("runs no second suite behind a retired rollout flag", () => {
    // P0-3: the three trusted-handoff rollout flags are retired, so there is no
    // second suite whose behaviour a deployment lacks.
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    expect(Object.keys(workflow.jobs)).toEqual([
      "law-pins",
      "change-scope",
      ...LAYOUT_PIN_JOBS,
      "full-suite",
    ]);
    const envKeys = [
      workflow.env,
      ...Object.values(workflow.jobs).flatMap((job) => [
        job.env,
        ...job.steps.map((step) => step.env),
      ]),
    ].flatMap((env) => Object.keys(env ?? {}));
    for (const flag of [
      "PUBMAX_TONIGHT_GROUPING",
      "PUBMAX_MAP_ROUTE_TRANSFER",
      "PUBMAX_PAL_HANDOFF",
    ]) {
      expect(envKeys).not.toContain(flag);
    }
  });

  it("runs the layout-pinning browser specs on every screen-code pull request, in three named shards", () => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    const layoutJobs = LAYOUT_PIN_JOBS.map((id) => defined(jobs[id], id));
    layoutJobs.forEach((job, index) => {
      // A fixed name, so a job skipped for a docs change still reports under
      // the check name branch protection waits for.
      expect(job.name).toBe(`Browser layout pins (${index + 1}/3)`);
      expect(job.strategy).toBeUndefined();
      expect(job.env?.LAYOUT_SHARD).toBe(index + 1);
      expect(job.needs).toEqual(["change-scope"]);
      expect(job.if).toBe(LAYOUT_PIN_IF);
      // One step list for all three, so the shards cannot drift apart.
      expect(job.steps).toEqual(defined(layoutJobs[0]).steps);
    });
    const layoutPinsJob = defined(layoutJobs[0]);
    const [testStep, ...extraTestSteps] = playwrightSteps(layoutPinsJob);
    expect(extraTestSteps).toEqual([]);
    expect(testStep?.if).toBeUndefined();
    const run = runWords(defined(testStep, "layout-pins Playwright step").run);
    expect(run).toContain(`--shard=\${{ env.LAYOUT_SHARD }}/${LAYOUT_PIN_JOBS.length}`);
    expect(run).toContain("--workers=1");
    // These specs alone now hold layout once pinned by source-text unit tests.
    for (const spec of [
      "e2e/desktop-map-chrome-fit.spec.ts",
      "e2e/mobile-map-chrome-fit.spec.ts",
      "e2e/mobile-map-shell-matrix.spec.ts",
      "e2e/ui-consistency-layout.spec.ts",
      "e2e/map-desktop-arrival-chrome.spec.ts",
    ]) {
      expect(run).toContain(spec);
    }
    for (const project of ["chromium", "chromium-gl", "chromium-no-gl"]) {
      expect(run).toContain(`--project=${project}`);
    }

    const gate = runWords(
      layoutPinsJob.steps.find((step) =>
        runWords(step.run).includes("scripts/assert-playwright-gate.mjs"),
      )?.run,
    );
    expect(gate).toContain("--require-zero-skipped");
    expect(gate[gate.indexOf("scripts/assert-playwright-gate.mjs") + 1]).toBe(
      testStep?.env?.PLAYWRIGHT_JSON_OUTPUT_NAME,
    );
  });

  it("runs the same layout steps for every pull request branch", () => {
    // The before/after evidence steps for three October branches were gated
    // on their names. Those pull requests merged, and no step may be kept
    // for one branch again.
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    for (const id of LAYOUT_PIN_JOBS) {
      for (const step of defined(jobs[id]).steps) {
        expect(step.if, `${id} / ${step.name}`).toBeUndefined();
      }
    }
  });

  it("names only spec files that exist in each pull-request browser job", () => {
    // Playwright ORs its file filters, so a renamed spec would drop out silently.
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS]) {
      const specs = playwrightSteps(defined(jobs[jobName])).flatMap((step) =>
        runWords(step.run).filter((word) => word.startsWith("e2e/")),
      );
      expect(specs.length, jobName).toBeGreaterThan(0);
      for (const spec of specs) {
        expect(existsSync(join(process.cwd(), spec)), spec).toBe(true);
      }
    }
  });

  it("installs Chromium and its system dependencies before every Playwright run", () => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, "full-suite"]) {
      const steps = defined(jobs[jobName]).steps;
      const install = steps.findIndex((step) =>
        step.run?.split("\n").some((line) => {
          const words = line.trim().split(/\s+/);
          return (
            words.slice(0, 3).join(" ") === "npx playwright install" &&
            words.includes("--with-deps") &&
            words.includes("chromium")
          );
        }),
      );
      const playwrightRuns = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.run?.includes("npx playwright test"));

      expect(install, jobName).toBeGreaterThanOrEqual(0);
      expect(playwrightRuns.length, jobName).toBeGreaterThan(0);
      for (const { index } of playwrightRuns) {
        expect(index, jobName).toBeGreaterThan(install);
      }
    }
  });

  it("chooses a runner-specific Playwright port before every Playwright run", () => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, "full-suite"]) {
      const steps = defined(jobs[jobName]).steps;
      const portStep = steps.findIndex(
        (step) => step.uses === "./.github/actions/pubmax-playwright-port",
      );
      const playwrightRuns = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.run?.includes("npx playwright test"));

      expect(portStep, jobName).toBeGreaterThanOrEqual(0);
      expect(playwrightRuns.length, jobName).toBeGreaterThan(0);
      for (const { index } of playwrightRuns) {
        expect(index, jobName).toBeGreaterThan(portStep);
      }
    }
  });

  it("gives each production browser build enough heap", () => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, "full-suite"]) {
      const steps = playwrightSteps(defined(jobs[jobName]));
      expect(steps.length, jobName).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.env?.NODE_OPTIONS, jobName).toBe(
          "--max-old-space-size=6144",
        );
      }
    }
  });
});
