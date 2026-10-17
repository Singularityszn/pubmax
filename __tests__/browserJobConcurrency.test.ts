// BROWSER JOBS DO NOT SHARE A MACHINE.
//
// On 3-4 Oct 2026 several jobs that each start a production server and
// Chromium ran together on one Mac and timed out. GitHub-hosted runners are
// separate machines, so those jobs are not queued behind one group. A newer
// pull request head still cancels that pull request's older run, and no
// other run is ever cancelled.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

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

describe("browser jobs on hosted runners", () => {
  const playwrightJobs = workflows.flatMap(({ file, parsed }) =>
    Object.entries(parsed.jobs)
      .filter(([, job]) => runsPlaywright(job))
      .map(([jobId, job]) => ({ file, jobId, job })),
  );

  it("finds the jobs that start a server and Chromium", () => {
    expect(playwrightJobs.map(({ file, jobId }) => `${file} / ${jobId}`).sort()).toEqual([
      "e2e.yml / full-suite",
      "e2e.yml / law-pins",
      "e2e.yml / layout-pins",
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
  // (16 Oct 2026), so only a pull request shares a group with its own heads.
  it("supersedes an older head of the same pull request and nothing else", () => {
    const pullRequestWorkflows = workflows.filter(({ parsed }) =>
      (typeof parsed.on === "string" ? [parsed.on] : Object.keys(parsed.on)).includes("pull_request"),
    );
    expect(pullRequestWorkflows.map(({ file }) => file)).toEqual([
      "ci.yml",
      "e2e.yml",
      "rls-session.yml",
      "security-ci.yml",
    ]);
    for (const { file, parsed } of pullRequestWorkflows) {
      expect(parsed.concurrency, file).toEqual({
        group:
          "${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
        "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
      });
    }
  });
});
