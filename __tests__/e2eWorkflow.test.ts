import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { defined } from "@/__tests__/helpers/defined";
import { browserJobCondition } from "@/__tests__/helpers/browserJobCondition";

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
// The nightly full suite: the plain Chromium project in count-cut shards, and
// every other project the default run covers in one job of its own.
const FULL_SUITE_JOBS = ["full-suite", "full-suite-gl"];

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
      "e2e/one-good-night-recovery.spec.ts",
      "e2e/seo-audit-discovery.spec.ts",
    ]) {
      expect(run).toContain(spec);
    }
    expect(run).toContain("--project=chromium");
  });

  it.each([
    { event: "pull_request", fork: false, expected: false },
    { event: "pull_request", fork: true, expected: false },
    { event: "push", expected: false },
    { event: "schedule", expected: true },
    { event: "workflow_dispatch", expected: true },
  ] as const)("applies full-suite eligibility to $event ($expected)", ({ expected, ...context }) => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    for (const id of FULL_SUITE_JOBS) {
      expect(browserJobCondition(defined(jobs[id], id).if, context), id).toBe(expected);
    }
  });

  it("keeps the exhaustive browser matrix on nightly and manual runs", () => {
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    expect(workflow.on.schedule).toEqual([
      expect.objectContaining({ cron: expect.any(String) }),
    ]);
    expect(Object.keys(workflow.on)).toContain("workflow_dispatch");
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    const fullSuiteJob = defined(workflow.jobs["full-suite"], "full-suite job");
    const glJob = defined(workflow.jobs["full-suite-gl"], "full-suite-gl job");
    const shards = fullSuiteJob.strategy?.matrix?.shard;
    expect(shards).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(fullSuiteJob.name).toBe(`Full browser suite (\${{ matrix.shard }}/${shards?.length})`);
    const [shardStep, ...extraShardSteps] = playwrightSteps(fullSuiteJob);
    expect(extraShardSteps).toEqual([]);
    const shardRun = runWords(defined(shardStep, "full-suite Playwright step").run);
    expect(shardRun.filter((word) => word.startsWith("--shard="))).toEqual([
      `--shard=\${{ matrix.shard }}/${shards?.length}`,
    ]);
    // The Chromium shards build one server; only the keyless project needs two.
    expect(shardStep?.env?.PW_SKIP_KEYLESS_WEBSERVER).toBe("1");

    // Between them the two jobs run every project the nightly always ran, and
    // each project once.
    const [glStep, ...extraGlSteps] = playwrightSteps(glJob);
    expect(extraGlSteps).toEqual([]);
    const glRun = runWords(defined(glStep, "full-suite-gl Playwright step").run);
    expect(glRun.filter((word) => word.startsWith("--shard="))).toEqual([]);
    expect(glStep?.env?.PW_SKIP_KEYLESS_WEBSERVER).toBeUndefined();
    const projects = (run: string[]) =>
      run.filter((word) => word.startsWith("--project=")).map((word) => word.slice("--project=".length));
    expect(projects(shardRun)).toEqual(["chromium"]);
    expect(projects(glRun).sort()).toEqual([
      "chromium-gl",
      "chromium-keyless",
      "chromium-no-gl",
      "chromium-sw-gl",
    ]);
    for (const [job, step] of [[fullSuiteJob, shardStep], [glJob, glStep]] as const) {
      const report = defined(step?.env?.PLAYWRIGHT_JSON_OUTPUT_NAME, "JSON report name");
      const gate = runWords(
        job.steps.find((candidate) =>
          runWords(candidate.run).includes("scripts/assert-playwright-gate.mjs"),
        )?.run,
      );
      expect(gate[gate.indexOf("scripts/assert-playwright-gate.mjs") + 1]).toBe(report);
    }
  });

  it("starts the nightly in the evening, so GitHub's usual delay lands it before the working day", () => {
    // GitHub created the 03:17 UTC schedule at 09:40 to 11:11 UTC from 29 Oct
    // to 7 Nov 2026, and the full suite then held the Mac pool all morning.
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    expect(workflow.on.schedule).toEqual([{ cron: "17 20 * * *" }]);
  });

  it("opens or updates one issue when a scheduled full suite fails, with the run's own token", () => {
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow & {
      permissions?: Record<string, string>;
    };
    const job = defined(workflow.jobs["nightly-failure-issue"], "nightly-failure-issue job") as WorkflowJob & {
      permissions?: Record<string, string>;
      "timeout-minutes"?: number;
    };
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.needs).toEqual(FULL_SUITE_JOBS);
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job.permissions).toEqual({ issues: "write" });
    expect(job.if).toContain("github.event_name == 'schedule'");
    expect(job.if).toContain("always()");
    expect(job.if).toContain("contains(needs.*.result, 'failure')");
    expect(job.if).toContain("contains(needs.*.result, 'cancelled')");
    // No checkout and no repository code: the job only talks to GitHub.
    expect(job.steps.map((step) => step.uses).filter(Boolean)).toEqual([]);
    const [step, ...extra] = job.steps;
    expect(extra).toEqual([]);
    expect(step?.env?.GH_TOKEN).toBe("${{ github.token }}");
    expect(JSON.stringify(job)).not.toContain("secrets.");
    expect(step?.run).toContain("gh issue comment");
    expect(step?.run).toContain("gh issue create");
  });

  it("runs no second suite behind a retired rollout flag", () => {
    // P0-3: the three trusted-handoff rollout flags are retired, so there is no
    // second suite whose behaviour a deployment lacks.
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    expect(Object.keys(workflow.jobs)).toEqual([
      "law-pins",
      "change-scope",
      ...LAYOUT_PIN_JOBS,
      ...FULL_SUITE_JOBS,
      "nightly-failure-issue",
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
      // One step list for all three, so the shards cannot drift apart.
      expect(job.steps).toEqual(defined(layoutJobs[0]).steps);
    });
    const layoutPinsJob = defined(layoutJobs[0]);
    const [testStep, ...extraTestSteps] = playwrightSteps(layoutPinsJob);
    expect(extraTestSteps).toEqual([]);
    expect(testStep?.if).toBeUndefined();
    const run = runWords(defined(testStep, "layout-pins Playwright step").run);
    expect(run).toContain(`--shard=\${{ env.LAYOUT_SHARD }}/${LAYOUT_PIN_JOBS.length}`);
    // These specs hold layout once pinned by source-text tests and the
    // clicked UK arrival notice beside the live map credit control.
    for (const spec of [
      "e2e/desktop-map-chrome-fit.spec.ts",
      "e2e/mobile-map-chrome-fit.spec.ts",
      "e2e/mobile-map-shell-matrix.spec.ts",
      "e2e/ui-consistency-layout.spec.ts",
      "e2e/landing-uk-directory.spec.ts",
      "e2e/map-desktop-arrival-chrome.spec.ts",
      // The venue-type chips and the map credit. Two chip changes (29 and
      // 31 Oct 2026) merged green while this spec ran only nightly.
      "e2e/drink-chip-controls.spec.ts",
      // The desktop toolbar, the first location prompt and the Tonight lane
      // at 32px browser text. #2495 merged with this spec in no CI job.
      "e2e/desktop-map-large-text.spec.ts",
      "e2e/native-onboarding-actions.spec.ts",
      "e2e/web-first-run-journey.spec.ts",
      // The Plan result as a route: enlarged stop text and the touch lift,
      // reorder and scroll. #2500 merged with this spec in no CI job.
      "e2e/plan-route-result.spec.ts",
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

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
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

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
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

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
      const steps = playwrightSteps(defined(jobs[jobName]));
      expect(steps.length, jobName).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.env?.NODE_OPTIONS, jobName).toBe(
          "--max-old-space-size=6144",
        );
      }
    }
  });

  it("skips each browser build's own type check, which the CI TypeScript 6 job already runs wider", () => {
    // next build type-checks with TypeScript 6. The CI Typecheck (TypeScript 6) job
    // runs that compiler over a superset of the files on the same commit, and
    // on a macOS runner the build's copy took over 6 minutes and pushed the
    // Playwright web server past its 10 minute start limit (captain, 2 Nov
    // 2026; docs/CI_RUNBOOK.md, "Build cache and type check").
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
      for (const step of playwrightSteps(defined(jobs[jobName]))) {
        expect(step.env?.PUBMAX_CI_SKIP_BUILD_TYPECHECK, jobName).toBe("1");
      }
    }
  });
});
