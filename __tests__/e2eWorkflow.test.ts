import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { defined } from "@/__tests__/helpers/defined";

type WorkflowStep = { uses?: string; run?: string };
type Workflow = {
  jobs: Record<
    string,
    { steps: WorkflowStep[]; strategy?: { matrix?: { shard?: number[] } } }
  >;
};

describe("browser CI policy", () => {
  const workflowPath = join(process.cwd(), ".github", "workflows", "e2e.yml");

  it("runs a bounded law-pinning browser suite on pull requests and main", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toContain("e2e/smoke.spec.ts");
    expect(workflow).toContain("e2e/map-surface-history.spec.ts");
    expect(workflow).toContain("e2e/mobile-map-chrome-fit.spec.ts");
    expect(workflow).toContain("--project=chromium");
  });

  it("keeps the exhaustive browser matrix on nightly and manual runs", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/schedule:/);
    expect(workflow).toMatch(/push:\n\s+branches: \[main\]/);
    const fullSuiteJob = (parse(workflow) as Workflow).jobs["full-suite"];
    if (!fullSuiteJob) throw new Error("e2e workflow has no full-suite job");
    const shards = fullSuiteJob.strategy?.matrix?.shard;
    expect(shards).toEqual([1, 2, 3, 4]);
    const shardFlags = fullSuiteJob.steps.flatMap((step) =>
      [...(step.run ?? "").matchAll(/--shard=(.+?)\/(\d+)/g)].map((match) => ({
        index: match[1],
        total: Number(match[2]),
      })),
    );
    expect(shardFlags).toEqual([
      { index: "${{ matrix.shard }}", total: shards?.length },
    ]);
    // P0-3: the three trusted-handoff rollout flags are retired, so there is no
    // second suite whose behaviour a deployment lacks.
    expect(workflow).not.toContain("flag-on");
    expect(workflow).not.toContain("PUBMAX_TONIGHT_GROUPING");
    expect(workflow).not.toContain("PUBMAX_MAP_ROUTE_TRANSFER");
    expect(workflow).not.toContain("PUBMAX_PAL_HANDOFF");

    const fullSuite = workflow.slice(workflow.indexOf("  full-suite:"));
    expect(fullSuite).toContain(
      "if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    );

    const lawPins = workflow.slice(
      workflow.indexOf("  law-pins:"),
      workflow.indexOf("  layout-pins:"),
    );
    expect(lawPins).not.toContain("if: github.event_name");
  });

  it("runs the layout-pinning browser specs on every pull request, in three shards", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const layoutPinsJob = (parse(workflow) as Workflow).jobs["layout-pins"];
    if (!layoutPinsJob) throw new Error("e2e workflow has no layout-pins job");
    const shards = layoutPinsJob.strategy?.matrix?.shard;
    expect(shards).toEqual([1, 2, 3]);
    const run = layoutPinsJob.steps
      .map((step) => step.run ?? "")
      .filter((script) => script.includes("npx playwright test"))
      .join("\n");
    expect(run).toContain(`--shard=\${{ matrix.shard }}/${shards?.length}`);
    expect(run).toContain("--workers=1");
    // These specs alone now hold layout once pinned by source-text unit tests.
    for (const spec of [
      "e2e/desktop-map-chrome-fit.spec.ts",
      "e2e/mobile-map-shell-matrix.spec.ts",
      "e2e/ui-consistency-layout.spec.ts",
      "e2e/map-desktop-arrival-chrome.spec.ts",
    ]) {
      expect(run).toContain(spec);
    }
    for (const project of ["chromium", "chromium-gl", "chromium-no-gl"]) {
      expect(run.split(/\s+/)).toContain(`--project=${project}`);
    }

    const layoutPins = workflow.slice(
      workflow.indexOf("  layout-pins:"),
      workflow.indexOf("  full-suite:"),
    );
    expect(layoutPins).not.toContain("if: github.event_name");
    expect(layoutPins).toContain("--require-zero-skipped");
  });

  it("installs Chromium and its system dependencies before every Playwright run", () => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    for (const jobName of ["law-pins", "layout-pins", "full-suite"]) {
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
      const playwrightSteps = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.run?.includes("npx playwright test"));

      expect(install, jobName).toBeGreaterThanOrEqual(0);
      expect(playwrightSteps.length, jobName).toBeGreaterThan(0);
      for (const { index } of playwrightSteps) {
        expect(index, jobName).toBeGreaterThan(install);
      }
    }
  });

  it("chooses a runner-specific Playwright port before every Playwright run", () => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    for (const jobName of ["law-pins", "layout-pins", "full-suite"]) {
      const steps = defined(jobs[jobName]).steps;
      const portStep = steps.findIndex(
        (step) => step.uses === "./.github/actions/pubmax-playwright-port",
      );
      const playwrightSteps = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.run?.includes("npx playwright test"));

      expect(portStep, jobName).toBeGreaterThanOrEqual(0);
      expect(playwrightSteps.length, jobName).toBeGreaterThan(0);
      for (const { index } of playwrightSteps) {
        expect(index, jobName).toBeGreaterThan(portStep);
      }
    }
  });

  it("gives each production browser build enough heap", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow.match(/NODE_OPTIONS: "--max-old-space-size=6144"/g)).toHaveLength(3);
  });
});
