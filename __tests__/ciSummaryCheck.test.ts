// The required checks and the merge queue (captain, 7 Nov 2026; docs/CI_RUNBOOK.md,
// "The required checks and the merge queue"). The main ruleset requires one
// summary check per pull-request workflow, so each summary has to need every
// job a pull request runs and be red whenever one of them is. The merge queue
// runs each required workflow again on the commit that will land, so each one
// listens for `merge_group`. The freshness gate left the pull-request path:
// it runs on a schedule, before a release and on a change to data.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { browserJobCondition } from "@/__tests__/helpers/browserJobCondition";
import { defined } from "@/__tests__/helpers/defined";
import {
  FRESHNESS_GATE_COMMANDS,
  ReleaseRefusal,
  freshnessPreflight,
} from "@/scripts/lib/releaseProduction.mjs";

type Step = { name?: string; run?: string; env?: Record<string, string>; uses?: string };
type Job = { name?: string; if?: string; needs?: string | string[]; "timeout-minutes"?: number; steps?: Step[] };
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job> };

const ROOT = process.cwd();

function workflow(file: string): Workflow {
  return parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8")) as Workflow;
}

function needsOf(job: Job): string[] {
  return job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
}

/**
 * The check names the main ruleset requires. Changing one is a settings
 * change too: the runbook's ruleset payload names the same three.
 */
const REQUIRED_CHECKS = [
  { file: "ci.yml", job: "check", name: "CI check" },
  { file: "e2e.yml", job: "check", name: "Browser tests check" },
  { file: "rls-session.yml", job: "rls-session", name: "Effective RLS (Postgres 16 + PostgREST 14)" },
] as const;

// Jobs that never run for a pull request or the merge queue, so the summary
// does not wait for them: the nightly and dispatched full browser suite.
const NOT_PULL_REQUEST_JOBS: Record<string, string[]> = {
  "ci.yml": [],
  "e2e.yml": ["full-suite", "full-suite-gl"],
};

describe("the required checks", () => {
  it.each(REQUIRED_CHECKS)("$file names $name and runs in the merge queue", ({ file, job, name }) => {
    const parsed = workflow(file);
    expect(defined(parsed.jobs[job], `${file} / ${job}`).name).toBe(name);
    expect(Object.keys(parsed.on)).toEqual(expect.arrayContaining(["pull_request", "merge_group"]));
  });

  it("gives every required check a name no other job shares", () => {
    const names = ["ci.yml", "e2e.yml", "rls-session.yml", "security-ci.yml", "freshness.yml"].flatMap((file) =>
      Object.values(workflow(file).jobs).map((job) => job.name),
    );
    for (const { name } of REQUIRED_CHECKS) {
      expect(names.filter((candidate) => candidate === name), name).toHaveLength(1);
    }
  });

  it.each(Object.keys(NOT_PULL_REQUEST_JOBS))("%s: the summary needs every pull request job and always reports", (file) => {
    const { jobs } = workflow(file);
    const summary = defined(jobs.check, `${file} / check`);
    // A skipped summary counts as passed, so it must run even when a job it
    // needs failed or was cancelled.
    expect(summary.if).toBe("${{ always() }}");
    const expected = Object.keys(jobs)
      .filter((id) => id !== "check" && !defined(NOT_PULL_REQUEST_JOBS[file]).includes(id))
      .sort();
    expect([...needsOf(summary)].sort()).toEqual(expected);
    // Every job a needed job waits for is needed too, so a skip caused by an
    // upstream failure always arrives with that failure beside it.
    for (const id of needsOf(summary)) {
      for (const upstream of needsOf(defined(jobs[id], id))) expect(needsOf(summary), `${id} needs ${upstream}`).toContain(upstream);
    }
    expect(summary["timeout-minutes"]).toBe(5);
    // It checks out nothing and runs no repository code: it reads the results.
    expect(summary.steps?.map((step) => step.uses).filter(Boolean)).toEqual([]);
  });

  it("uses one summary step in both workflows", () => {
    expect(defined(workflow("e2e.yml").jobs.check).steps).toEqual(defined(workflow("ci.yml").jobs.check).steps);
  });

  const summaryRun = defined(defined(workflow("ci.yml").jobs.check).steps?.[0]?.run, "summary run");

  function summarise(results: Record<string, string>) {
    const needs = Object.fromEntries(
      Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]),
    );
    return spawnSync("bash", ["-e", "-c", summaryRun], {
      encoding: "utf8",
      env: { ...process.env, NEEDS: JSON.stringify(needs) },
    });
  }

  it.each<{ results: Record<string, string>; status: number }>([
    { results: { lint: "success", build: "success" }, status: 0 },
    // A job its own `if` skipped (Review scope in the queue, a layout pin
    // with no screen code) is not a failure.
    { results: { lint: "success", "review-scope": "skipped" }, status: 0 },
    { results: { lint: "success", build: "failure" }, status: 1 },
    { results: { lint: "cancelled", build: "success" }, status: 1 },
    { results: { lint: "failure", coverage: "skipped" }, status: 1 },
  ])("is red when a needed job failed or was cancelled: $results", ({ results, status }) => {
    const result = summarise(results);
    expect(result.status, result.stderr).toBe(status);
    for (const [job, outcome] of Object.entries(results)) expect(result.stdout).toContain(`${job}: ${outcome}`);
    if (status !== 0) expect(result.stdout).toContain("::error::Not green:");
  });

  it("keeps the layout pins off the merge queue, as their own triggers were left", () => {
    const { jobs } = workflow("e2e.yml");
    for (const id of ["layout-pins-1", "layout-pins-2", "layout-pins-3"]) {
      const condition = defined(jobs[id], id).if;
      expect(browserJobCondition(condition, { event: "merge_group" }), id).toBe(false);
      expect(browserJobCondition(condition, { event: "pull_request" }), id).toBe(true);
      expect(browserJobCondition(condition, { event: "push" }), id).toBe(true);
    }
  });

  it("keeps Security CI advisory and out of the merge queue", () => {
    expect(Object.keys(workflow("security-ci.yml").on)).not.toContain("merge_group");
  });
});

describe("the freshness gate", () => {
  const parsed = workflow("freshness.yml");
  const DATA_PATHS = [
    "data/**",
    "public/data/**",
    "scripts/check_freshness.mjs",
    "scripts/check-production-store-freshness.mjs",
    ".github/workflows/freshness.yml",
  ];

  it("is off the default pull-request path", () => {
    expect(Object.keys(workflow("ci.yml").jobs)).not.toContain("freshness");
    expect(Object.keys(parsed.on).sort()).toEqual(["pull_request", "push", "schedule", "workflow_dispatch"]);
    expect(parsed.on.pull_request).toEqual({ paths: DATA_PATHS });
    expect(parsed.on.push).toEqual({ branches: ["main"], paths: DATA_PATHS });
    expect(parsed.on.schedule).toEqual([{ cron: expect.stringMatching(/^\d+ \d+ \* \* \*$/) }]);
  });

  it("runs the two commands the release preflight runs, and installs nothing", () => {
    const job = defined(parsed.jobs.freshness, "freshness job");
    expect(job.name).toBe("Freshness release gate");
    const commands = (job.steps ?? []).flatMap((step) =>
      (step.run ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
    );
    expect(commands).toEqual(FRESHNESS_GATE_COMMANDS.map(([command, args]) => [command, ...args].join(" ")));
  });

  it("refuses a release before any upload when a freshness command fails", async () => {
    const calls: string[] = [];
    const preflight = freshnessPreflight(async (command, args) => {
      calls.push([command, ...args].join(" "));
      return { status: args[0] === "scripts/check-production-store-freshness.mjs" ? 1 : 0, stdout: "" };
    });
    await expect(preflight.run()).rejects.toBeInstanceOf(ReleaseRefusal);
    expect(calls).toEqual(FRESHNESS_GATE_COMMANDS.map(([command, args]) => [command, ...args].join(" ")));
  });

  it("passes a release when both freshness commands pass", async () => {
    const preflight = freshnessPreflight(async () => ({ status: 0, stdout: "" }));
    await expect(preflight.run()).resolves.toBeUndefined();
  });
});
