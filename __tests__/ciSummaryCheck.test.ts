import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { browserJobCondition } from "@/__tests__/helpers/browserJobCondition";
import { defined } from "@/__tests__/helpers/defined";
import {
  ReleaseRefusal,
  freshnessPreflight,
} from "@/scripts/lib/releaseProduction.mjs";

type Step = { name?: string; id?: string; run?: string; if?: string; env?: Record<string, string>; uses?: string; with?: Record<string, unknown> };
type Job = { name?: string; if?: string; needs?: string | string[]; "timeout-minutes"?: number; steps?: Step[]; outputs?: Record<string, string> };
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job> };

const ROOT = process.cwd();

function workflow(file: string): Workflow {
  return parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8")) as Workflow;
}

function needsOf(job: Job): string[] {
  return job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
}

const REQUIRED_CHECKS = [
  { file: "ci.yml", job: "check", name: "CI check" },
  { file: "e2e.yml", job: "check", name: "Browser tests check" },
  { file: "rls-session.yml", job: "check", name: "RLS session check" },
  { file: "security-ci.yml", job: "check", name: "Security CI check" },
  { file: "freshness.yml", job: "check", name: "Freshness check" },
] as const;

// Jobs that never run for a pull request or the merge queue, so the summary
// does not wait for them: the nightly and dispatched full browser suite.
const NOT_PULL_REQUEST_JOBS: Record<string, string[]> = {
  "ci.yml": [],
  "e2e.yml": ["full-suite", "full-suite-gl"],
  "rls-session.yml": [],
  "security-ci.yml": [],
  "freshness.yml": [],
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

  it.each(REQUIRED_CHECKS)("$file uses the same summary step", ({ file }) => {
    expect(defined(workflow(file).jobs.check).steps).toEqual(defined(workflow("ci.yml").jobs.check).steps);
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
    { results: { "change-scope": "success", freshness: "skipped" }, status: 0 },
    { results: { "change-scope": "failure", freshness: "success" }, status: 1 },
    { results: { "change-scope": "success", freshness: "failure" }, status: 1 },
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
});

describe("the freshness gate", () => {
  const parsed = workflow("freshness.yml");
  const expectedCommands = [
    "node scripts/check_freshness.mjs --artifacts-only",
    "node scripts/check-production-store-freshness.mjs",
  ];
  const scratch = mkdtempSync(join(tmpdir(), "pubmax-freshness-ci-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const detection = defined(parsed.jobs["change-scope"]);
  const classify = defined(detection.steps?.find((step) => step.id === "scope"));
  const freshness = defined(parsed.jobs.freshness);

  it("always reports for pull requests and merge groups without running on pushes", () => {
    expect(Object.keys(workflow("ci.yml").jobs)).not.toContain("freshness");
    expect(Object.keys(parsed.on).sort()).toEqual(["merge_group", "pull_request", "schedule", "workflow_dispatch"]);
    expect(parsed.on.pull_request).toBeNull();
    expect(parsed.on.merge_group).toBeNull();
    expect(parsed.on.schedule).toEqual([{ cron: "47 7 * * *" }]);
    expect(detection.outputs).toEqual({ run: "${{ steps.scope.outputs.run }}" });
    expect(detection.steps?.[0]?.with?.["fetch-depth"]).toBe(2);
    expect(classify.env).toEqual({
      EVENT_NAME: "${{ github.event_name }}",
      BASE_SHA: "${{ github.event.merge_group.base_sha }}",
      HEAD_SHA: "${{ github.event.merge_group.head_sha }}",
    });
  });

  function git(repo: string, ...args: string[]): string {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  }

  function classifyChange(repo: string, event: string, base = "", head = "") {
    const output = join(repo, "github-output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-e", "-c", defined(classify.run)], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, EVENT_NAME: event, BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output },
    });
    return { ...result, output: readFileSync(output, "utf8") };
  }

  const changes = [
    { path: "data/new.json", run: true },
    { path: "public/data/new.json", run: true },
    { path: "data/freshness_registry.json", run: true },
    { path: "data/feed.csv", run: true },
    { path: "docs/readme.md", run: false },
    { path: "scripts/check_freshness.mjs", run: false },
    { path: "scripts/check-production-store-freshness.mjs", run: false },
    { path: ".github/workflows/freshness.yml", run: false },
    { path: "data-other/feed.json", run: false },
    { path: "public/database.json", run: false },
    { path: "data/existing.json", moveTo: "docs/moved.json", run: true },
    { path: "public/data/existing.json", remove: true, run: true },
    { path: "", run: false },
  ];

  describe.each(["pull_request", "merge_group"])("%s detection", (event) => {
    it.each(changes)("classifies $path as $run", ({ path, moveTo, remove, run }) => {
      const repo = mkdtempSync(join(scratch, "repo-"));
      git(repo, "init", "-q");
      git(repo, "config", "user.name", "test");
      git(repo, "config", "user.email", "test@example.invalid");
      for (const file of ["seed.txt", "data/existing.json", "public/data/existing.json"]) {
        mkdirSync(join(repo, file, ".."), { recursive: true });
        writeFileSync(join(repo, file), "base\n");
      }
      const commit = () => {
        git(repo, "add", ".");
        git(repo, "commit", "-q", "--allow-empty", "-m", "fixture");
        return git(repo, "rev-parse", "HEAD");
      };
      const base = commit();
      if (moveTo) {
        mkdirSync(join(repo, moveTo, ".."), { recursive: true });
        git(repo, "mv", path, moveTo);
      } else if (remove) {
        git(repo, "rm", path);
      } else if (path) {
        mkdirSync(join(repo, path, ".."), { recursive: true });
        writeFileSync(join(repo, path), "changed\n");
      }
      const head = commit();
      if (event === "merge_group") {
        writeFileSync(join(repo, "data/unrelated.json"), "later\n");
        commit();
        const fetch = defined(detection.steps?.find((step) => step.name === "Fetch the queue range"));
        expect(fetch.if).toBe("github.event_name == 'merge_group'");
        expect(fetch.env).toEqual({
          BASE_SHA: "${{ github.event.merge_group.base_sha }}",
          HEAD_SHA: "${{ github.event.merge_group.head_sha }}",
        });
        git(repo, "remote", "add", "origin", repo);
        const fetched = spawnSync("bash", ["-e", "-c", defined(fetch.run)], {
          cwd: repo, encoding: "utf8", env: { ...process.env, BASE_SHA: base, HEAD_SHA: head },
        });
        expect(fetched.status, fetched.stderr).toBe(0);
      }
      const result = classifyChange(repo, event, base, head);
      expect(result.status, result.stderr).toBe(0);
      expect(result.output.trim()).toBe(`run=${run}`);
    });
  });

  it.each(["schedule", "workflow_dispatch"])("always runs on %s without a git diff", (event) => {
    const result = classifyChange(mkdtempSync(join(scratch, "no-git-")), event);
    expect(result.status, result.stderr).toBe(0);
    expect(result.output.trim()).toBe("run=true");
  });

  it("fails detection when the diff is unavailable", () => {
    const result = classifyChange(mkdtempSync(join(scratch, "no-git-")), "pull_request");
    expect(result.status).not.toBe(0);
    expect(result.output).toBe("");
  });

  it.each([
    ["success", "true", true],
    ["success", "false", false],
    ["failure", "", true],
    ["cancelled", "", true],
    ["skipped", "", true],
  ])("runs freshness for detection %s, output %s: %s", (result, run, expected) => {
    expect(needsOf(freshness)).toEqual(["change-scope"]);
    const expression = defined(freshness.if).replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
      .replaceAll("needs.change-scope", 'needs["change-scope"]');
    expect(runInNewContext(`(${expression})`, {
      always: () => true,
      needs: { "change-scope": { result, outputs: { run } } },
    }, { timeout: 1000 })).toBe(expected);
  });

  it.each([undefined, "scripts/check_freshness.mjs", "scripts/check-production-store-freshness.mjs"])(
    "executes both workflow commands and stops on %s failure",
    (failedScript) => {
      const bin = mkdtempSync(join(scratch, "bin-"));
      const log = join(bin, "calls");
      writeFileSync(join(bin, "node"), '#!/bin/sh\nprintf "node %s\\n" "$*" >> "$COMMAND_LOG"\n[ "$1" != "$FAIL_SCRIPT" ]\n');
      chmodSync(join(bin, "node"), 0o755);
      const script = (freshness.steps ?? []).flatMap((step) => step.run ? [step.run] : []).join("\n");
      const result = spawnSync("bash", ["-e", "-c", script], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, COMMAND_LOG: log, FAIL_SCRIPT: failedScript ?? "" },
      });
      expect(result.status, result.stderr).toBe(failedScript ? 1 : 0);
      const expected = failedScript === "scripts/check_freshness.mjs" ? expectedCommands.slice(0, 1) : expectedCommands;
      expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(expected);
      expect(freshness.steps?.filter((step) => step.uses).map((step) => step.uses?.split("@")[0])).toEqual([
        "actions/checkout", "actions/setup-node",
      ]);
    },
  );

  it.each([
    ["node scripts/check_freshness.mjs --artifacts-only", expectedCommands.slice(0, 1)],
    ["node scripts/check-production-store-freshness.mjs", expectedCommands],
  ])("refuses a release when %s fails", async (failedCommand, expected) => {
    const calls: string[] = [];
    const preflight = freshnessPreflight(async (command, args) => {
      const call = [command, ...args].join(" ");
      calls.push(call);
      return { status: call === failedCommand ? 1 : 0, stdout: "" };
    });
    await expect(preflight.run()).rejects.toBeInstanceOf(ReleaseRefusal);
    expect(calls).toEqual(expected);
  });

  it("passes a release only after both freshness commands pass", async () => {
    const calls: string[] = [];
    const preflight = freshnessPreflight(async (command, args) => {
      calls.push([command, ...args].join(" "));
      return { status: 0, stdout: "" };
    });
    await expect(preflight.run()).resolves.toBeUndefined();
    expect(calls).toEqual(expectedCommands);
  });
});
