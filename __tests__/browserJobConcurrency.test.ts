// ONE CHROMIUM ON THE SHARED MAC.
//
// On 3-4 Oct 2026 several jobs that each start a production server and
// Chromium ran together on the pubmax-mac runners. Host load reached about
// 79 and browser specs timed out; the same specs pass when the machine is
// quiet. Those jobs share one concurrency group and queue. Lint and unit
// tests stay out of it so they keep running beside the single browser job.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = process.cwd();
const BROWSER_GROUP = "pubmax-mac-browser";

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

describe("browser jobs on the shared Mac", () => {
  const playwrightJobs = workflows.flatMap(({ file, parsed }) =>
    Object.entries(parsed.jobs)
      .filter(([, job]) => runsPlaywright(job))
      .map(([jobId, job]) => ({ file, jobId, job })),
  );

  it("finds the jobs that start a server and Chromium", () => {
    expect(playwrightJobs.map(({ file, jobId }) => `${file} / ${jobId}`).sort()).toEqual([
      "e2e.yml / full-suite",
      "e2e.yml / law-pins",
      "performance.yml / performance-budget",
      "performance.yml / ux-lane-performance",
    ]);
  });

  it("queues them one at a time and leaves every other job free to run", () => {
    expect(playwrightJobs.length).toBeGreaterThan(0);
    for (const { file, jobId, job } of playwrightJobs) {
      expect(job.concurrency, `${file} / ${jobId}`).toEqual({
        group: BROWSER_GROUP,
        "cancel-in-progress": false,
        queue: "max",
      });
    }

    for (const { file, parsed } of workflows) {
      expect(parsed.concurrency?.group, file).not.toBe(BROWSER_GROUP);
      for (const [jobId, job] of Object.entries(parsed.jobs)) {
        if (runsPlaywright(job)) continue;
        expect(job.concurrency?.group, `${file} / ${jobId}`).not.toBe(BROWSER_GROUP);
      }
    }
  });

  it("still supersedes an older head of the same pull request", () => {
    const browser = workflows.find((workflow) => workflow.file === "e2e.yml");
    expect(browser?.parsed.concurrency).toMatchObject({
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    });
    expect(browser?.parsed.concurrency?.group).toContain("github.ref");
    expect(browser?.parsed.concurrency?.group).not.toBe(BROWSER_GROUP);
  });
});
