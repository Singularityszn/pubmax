// BROWSER JOBS DO NOT SHARE A MACHINE.
//
// On 3-4 Oct 2026 several jobs that each start a production server and
// Chromium ran together on one Mac and timed out. GitHub-hosted runners are
// separate machines, so those jobs are not queued behind one group. A newer
// pull request head still cancels that workflow's older run.

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

  it("still supersedes an older head of the same pull request", () => {
    const browser = workflows.find((workflow) => workflow.file === "e2e.yml");
    expect(browser?.parsed.concurrency).toMatchObject({
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    });
    expect(browser?.parsed.concurrency?.group).toContain("github.ref");
  });
});
