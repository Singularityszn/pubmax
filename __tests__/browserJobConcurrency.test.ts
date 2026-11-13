// BROWSER JOBS DO NOT SHARE A MACHINE.
//
// On 3-4 Oct 2026 several jobs that each start a production server and
// Chromium ran together on one Mac and timed out. A pubmax-mac place runs one
// job at a time, and each GitHub-hosted runner is its own machine, so those
// jobs are not queued behind one group. A newer
// pull request head still cancels that pull request's older run, and a newer
// main push replaces an older one that still waits to start Browser tests.
// No other run is ever cancelled.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { browserJobExpression } from "@/__tests__/helpers/browserJobCondition";

const ROOT = process.cwd();

type Step = { name?: string; run?: string };
type Concurrency = {
  group?: string;
  "cancel-in-progress"?: boolean | string;
  queue?: string;
};
type Job = {
  concurrency?: Concurrency;
  steps: Step[];
};
type Workflow = {
  on: Record<string, unknown> | string;
  concurrency?: Concurrency;
  jobs: Record<string, Job>;
};

const workflows = readdirSync(join(ROOT, ".github/workflows"))
  .filter((file) => file.endsWith(".yml"))
  .sort()
  .map((file) => {
    const source = readFileSync(join(ROOT, ".github/workflows", file), "utf8");
    return { file, parsed: parse(source) as Workflow };
  });

function runsPlaywright(job: Job): boolean {
  return job.steps.some(
    (step) => typeof step.run === "string" && /\bplaywright test\b/.test(step.run),
  );
}

describe("browser jobs on their runners", () => {
  const playwrightJobs = workflows.flatMap(({ file, parsed }) =>
    Object.entries(parsed.jobs)
      .filter(([, job]) => runsPlaywright(job))
      .map(([jobId, job]) => ({ file, jobId, job })),
  );

  it("finds the jobs that start a server and Chromium", () => {
    expect(playwrightJobs.map(({ file, jobId }) => `${file} / ${jobId}`).sort()).toEqual([
      "e2e.yml / full-suite",
      "e2e.yml / full-suite-gl",
      "e2e.yml / law-pins",
      "e2e.yml / layout-pins-1",
      "e2e.yml / layout-pins-2",
      "e2e.yml / layout-pins-3",
      "performance.yml / performance-budget",
      "performance.yml / ux-lane-performance",
      "prod-smoke.yml / smoke",
    ]);
  });

  it("does not queue them on one shared group", () => {
    expect(playwrightJobs.length).toBeGreaterThan(0);
    for (const { file, jobId, job } of playwrightJobs) {
      expect(job.concurrency, `${file} / ${jobId}`).toBeUndefined();
    }
    for (const { file, parsed } of workflows) {
      expect(parsed.concurrency?.group ?? "", file).not.toContain("pubmax-mac");
      expect(parsed.concurrency?.queue, file).toBeUndefined();
    }
  });

  // GitHub keeps one waiting run per group and cancels the older one, even
  // with cancel-in-progress off. A per-ref group dropped main pushes that way
  // (16 Oct 2026), so a pull request shares a group only with its own heads.
  // Browser tests is the one exception (captain, 19 Oct 2026): its main pushes
  // share one group, so only the newest push waits behind the one running.
  // It was set when each push started the macOS layout pins; since 9 Nov 2026
  // they run only in the merge queue and on a labelled pull request.
  // A main push is never cancelled while it runs, and a dispatch still
  // gets a group of its own.
  const OWN_RUN_GROUP =
    "${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}";

  it("supersedes an older head of the same pull request, and an older waiting main push of the browser tests", () => {
    const pullRequestWorkflows = workflows.filter(({ parsed }) =>
      (typeof parsed.on === "string" ? [parsed.on] : Object.keys(parsed.on)).includes("pull_request"),
    );
    expect(pullRequestWorkflows.map(({ file }) => file)).toEqual([
      "ci.yml",
      "e2e.yml",
      "freshness.yml",
      "rls-session.yml",
      "security-ci.yml",
    ]);
    for (const { file, parsed } of pullRequestWorkflows) {
      if (file !== "e2e.yml") expect(parsed.concurrency, file).toEqual({
        group: OWN_RUN_GROUP,
        "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
      });
    }
  });

  it("gives all five required workflows separate merge queue runs", () => {
    const required = ["ci.yml", "e2e.yml", "freshness.yml", "rls-session.yml", "security-ci.yml"];
    for (const file of required) {
      const parsed = workflows.find((entry) => entry.file === file)?.parsed;
      expect(parsed?.on, file).toHaveProperty("merge_group");
      if (file !== "e2e.yml") expect(parsed?.concurrency, file).toEqual({
        group: OWN_RUN_GROUP,
        "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
      });
    }
  });

  it.each([
    { event: "pull_request", expectedGroup: "pr-7", cancel: true },
    { event: "pull_request", action: "labeled", label: "layout-pins", expectedGroup: "pr-7", cancel: true },
    { event: "pull_request", action: "labeled", label: "needs-triage", expectedGroup: "run-123", cancel: false },
    { event: "push", expectedGroup: "main-push", cancel: false },
    { event: "merge_group", expectedGroup: "run-123", cancel: false },
    { event: "workflow_dispatch", expectedGroup: "run-123", cancel: false },
  ] as const)("applies browser concurrency for $event $label", ({ expectedGroup, cancel, ...context }) => {
    const concurrency = workflows.find(({ file }) => file === "e2e.yml")?.parsed.concurrency;
    expect(concurrency).toBeDefined();
    const group = (concurrency?.group ?? "").replace(/\$\{\{([\s\S]*?)\}\}/g, (expression) =>
      String(browserJobExpression(expression, context)));
    expect(group).toBe(`Browser tests-${expectedGroup}`);
    expect(browserJobExpression(String(concurrency?.["cancel-in-progress"]), context)).toBe(cancel);
    if (expectedGroup === "run-123") {
      const nextGroup = (concurrency?.group ?? "").replace(/\$\{\{([\s\S]*?)\}\}/g, (expression) =>
        String(browserJobExpression(expression, { ...context, runId: 124 })));
      expect(nextGroup).toBe("Browser tests-run-124");
    }
  });

  // The shared main-push group is safe only while Browser tests runs on
  // pushes to main and nowhere else: a push to any other branch would wait
  // in the same group as main and could drop a main run.
  it("starts Browser tests on a push to main only", () => {
    const e2e = workflows.find(({ file }) => file === "e2e.yml")?.parsed;
    expect(e2e?.on).toMatchObject({ push: { branches: ["main"] } });
  });
});
