import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { browserJobCondition, browserJobExpression, browserJobName } from "@/__tests__/helpers/browserJobCondition";
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
// does not wait for them: the full browser suite and its nightly failure report.
const NOT_PULL_REQUEST_JOBS: Record<string, string[]> = {
  "ci.yml": [],
  "e2e.yml": ["full-suite", "full-suite-gl", "nightly-failure-issue"],
  "rls-session.yml": [],
  "security-ci.yml": [],
  "freshness.yml": [],
};

describe("GitHub job status conditions", () => {
  it.each(["failure", "cancelled", "skipped"])("requires an explicit status check after %s", (result) => {
    const context = { results: ["success", result] };
    expect(browserJobCondition(undefined, context)).toBe(false);
    expect(browserJobCondition("${{ true }}", context)).toBe(false);
    expect(browserJobCondition("${{ 'always()' != '' }}", context)).toBe(false);
    expect(browserJobCondition("${{ always() }}", context)).toBe(true);
    expect(browserJobCondition("${{ !cancelled() }}", context)).toBe(true);
    expect(browserJobCondition("${{ success() }}", context)).toBe(false);
    expect(browserJobCondition("${{ failure() }}", context)).toBe(result === "failure");
    expect(browserJobExpression("${{ true }}", context)).toBe(true);
    expect(browserJobName("${{ true && 'check' || 'other' }}", context)).toBe("check");
  });

  it("runs ordinary conditions after success and respects workflow cancellation", () => {
    expect(browserJobCondition(undefined, { results: ["success", "success"] })).toBe(true);
    expect(browserJobCondition("false")).toBe(false);
    expect(browserJobCondition("true", { cancelled: true })).toBe(false);
    expect(browserJobCondition("!cancelled()", { cancelled: true })).toBe(false);
    expect(browserJobCondition("always()", { cancelled: true })).toBe(true);
  });
});

describe("the required checks", () => {
  it.each(REQUIRED_CHECKS)("$file names $name and runs in the merge queue", ({ file, job, name }) => {
    const parsed = workflow(file);
    expect(browserJobName(defined(parsed.jobs[job], `${file} / ${job}`).name)).toBe(name);
    expect(Object.keys(parsed.on)).toEqual(expect.arrayContaining(["pull_request", "merge_group"]));
  });

  it("gives every required check a name no other job shares", () => {
    const names = ["ci.yml", "e2e.yml", "rls-session.yml", "security-ci.yml", "freshness.yml"].flatMap((file) =>
      Object.values(workflow(file).jobs).map((job) => browserJobName(job.name)),
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
    for (const result of ["success", "failure", "cancelled", "skipped"]) {
      for (const dependency of needsOf(summary)) {
        const results = needsOf(summary).map((id) => id === dependency ? result : "success");
        expect(browserJobCondition(summary.if, { results, cancelled: result === "cancelled" }), `${file}: ${dependency}=${result}`).toBe(true);
      }
    }
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

  it("skips every unrelated-label job under a separate check name", () => {
    const { jobs } = workflow("e2e.yml");
    const names: Record<string, string> = {
      "queue-proof": "Merge queue proof",
      "law-pins": "Browser law pins",
      "change-scope": "Change scope",
      "layout-pins-1": "Browser layout pins (1/3)",
      "layout-pins-2": "Browser layout pins (2/3)",
      "layout-pins-3": "Browser layout pins (3/3)",
      check: "Browser tests check",
      "full-suite": "Full browser suite (1/8)",
      "full-suite-gl": "Full browser suite (WebGL and keyless)",
      "nightly-failure-issue": "Report a nightly full-suite failure",
    };
    expect(workflow("e2e.yml").on.pull_request).toEqual({ types: ["opened", "synchronize", "reopened", "labeled"] });
    const context = { action: "labeled", label: "needs-triage", labels: ["layout-pins", "needs-triage"], results: ["failure"] };
    for (const [id, job] of Object.entries(jobs)) {
      expect(browserJobCondition(job.if, context), id).toBe(false);
      const normal = defined(names[id], id);
      expect(browserJobName(job.name), id).toBe(normal);
      expect(browserJobName(job.name, context), id).toBe(`Not run for label - ${normal}`);
      expect(browserJobName(job.name, { ...context, label: "layout-pins" }), id).toBe(normal);
      for (const event of ["push", "merge_group", "workflow_dispatch"] as const) {
        expect(browserJobName(job.name, { event }), id).toBe(normal);
      }
    }
  });

  it("runs the layout pins in the merge queue, and on a pull request only with its label", () => {
    const { jobs } = workflow("e2e.yml");
    for (const id of ["layout-pins-1", "layout-pins-2", "layout-pins-3"]) {
      const condition = defined(jobs[id], id).if;
      expect(browserJobCondition(condition, { event: "merge_group" }), id).toBe(true);
      expect(browserJobCondition(condition, { event: "pull_request" }), id).toBe(false);
      expect(browserJobCondition(condition, { event: "pull_request", labels: ["layout-pins"] }), id).toBe(true);
      expect(browserJobCondition(condition, { event: "push" }), id).toBe(false);
      expect(browserJobCondition(condition, { action: "labeled", label: "layout-pins", labels: ["layout-pins"] }), id).toBe(true);
    }
  });
});

describe("a main push after the merge queue", () => {
  type Event = "pull_request" | "merge_group" | "push";
  type Proof = { result: "success" | "failure"; passed?: string };

  // A proved main push keeps Review scope, which the queue does not run.
  // The queue runs Production build, but main must save its cache
  // for pull requests, which cannot restore caches from merge queue refs.
  const MAIN_ONLY: Record<string, string[]> = {
    "ci.yml": ["production-build", "review-scope"],
    "e2e.yml": ["change-scope"],
    "rls-session.yml": [],
    "security-ci.yml": [],
  };
  const FILES = Object.keys(MAIN_ONLY);
  const scratch = mkdtempSync(join(tmpdir(), "pubmax-queue-proof-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  // GitHub starts a job only when its `if` holds. An `if` with no status
  // function gets an implicit success(): every ancestor job succeeded.
  function jobsThatRun(file: string, event: Event, proof: Proof, outcomes: Record<string, string> = {}): string[] {
    const { jobs } = workflow(file);
    const results: Record<string, { result: string; outputs: Record<string, string> }> = {};
    const pending = Object.keys(jobs);
    while (pending.length > 0) {
      const index = pending.findIndex((id) => needsOf(defined(jobs[id])).every((need) => need in results));
      expect(index, `${file}: a job waits for a job that never reports`).toBeGreaterThanOrEqual(0);
      const id = defined(pending.splice(index, 1)[0]);
      const job = defined(jobs[id]);
      const needs = Object.fromEntries(needsOf(job).map((need) => [need, defined(results[need])]));
      const ancestors = new Set(needsOf(job));
      for (const need of ancestors) {
        for (const upstream of needsOf(defined(jobs[need]))) ancestors.add(upstream);
      }
      const allSucceeded = () => [...ancestors].every((need) => defined(results[need]).result === "success");
      const expression = String(job.if ?? "true").trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1");
      const translated = expression
        .replaceAll("needs.*.result", "Object.values(needs).map((need) => need.result)")
        .replaceAll("github.event.pull_request.labels.*.name", "pullRequestLabels")
        .replace(/needs\.([\w-]+)/g, 'needs["$1"]');
      const holds = runInNewContext(`(${translated})`, {
        github: {
          event_name: event,
          repository: "Singularityszn/pubmax",
          event: { pull_request: { head: { repo: { full_name: "Singularityszn/pubmax" } } } },
        },
        needs,
        pullRequestLabels: [],
        always: () => true,
        cancelled: () => false,
        success: allSucceeded,
        failure: () => false,
        contains: (list: string[], value: string) => list.includes(value),
      }, { timeout: 1000 });
      const runs = Boolean(holds) && (/\b(always|cancelled|success|failure)\(/.test(expression) || allSucceeded());
      if (!runs) results[id] = { result: "skipped", outputs: {} };
      else if (id === "queue-proof") results[id] = { result: proof.result, outputs: proof.passed ? { passed: proof.passed } : {} };
      else results[id] = { result: outcomes[id] ?? "success", outputs: id === "change-scope" ? { scope: "code", layout: "ui" } : {} };
    }
    return Object.keys(results).filter((id) => results[id]?.result !== "skipped").sort();
  }

  function provedJobs(file: string): string[] {
    const { jobs } = workflow(file);
    return Object.keys(jobs).filter((id) => needsOf(defined(jobs[id])).includes("queue-proof"));
  }

  it.each(FILES)("%s skips the queue's work on a proved commit and keeps the main-only jobs", (file) => {
    expect(jobsThatRun(file, "push", { result: "success", passed: "true" })).toEqual(
      ["check", "queue-proof", ...defined(MAIN_ONLY[file])].sort(),
    );
  });

  it.each(FILES.flatMap((file) => [
    { file, event: "push" as const, proof: { result: "success" as const, passed: "false" } },
    { file, event: "push" as const, proof: { result: "failure" as const } },
    { file, event: "pull_request" as const, proof: { result: "success" as const, passed: "true" } },
    { file, event: "merge_group" as const, proof: { result: "success" as const, passed: "true" } },
  ]))("$file runs every gated job on $event when the proof is $proof", ({ file, event, proof }) => {
    const running = jobsThatRun(file, event, proof);
    expect(provedJobs(file).length, file).toBeGreaterThan(0);
    for (const id of provedJobs(file)) expect(running, id).toContain(id);
    expect(running.includes("queue-proof"), "the proof runs only on a push").toBe(event === "push");
    if (file === "ci.yml") expect(running).toContain("coverage");
  });

  it.each(["pull_request", "merge_group"] as const)("%s runs Coverage despite its skipped proof ancestor", (event) => {
    const running = jobsThatRun("ci.yml", event, { result: "success" });
    expect(running).not.toContain("queue-proof");
    expect(running).toContain("unit-tests");
    expect(running).toContain("coverage");
  });

  it.each(["failure", "cancelled", "skipped"])("skips Coverage when unit shards report %s", (result) => {
    expect(jobsThatRun("ci.yml", "pull_request", { result: "success" }, { "unit-tests": result })).not.toContain("coverage");
  });

  it.each(FILES)("%s exposes read-only queue proof on pushes", (file) => {
    const proof = defined(workflow(file).jobs["queue-proof"]);
    expect(proof.if).toBe("github.event_name == 'push'");
    expect(proof).toHaveProperty("permissions", { actions: "read" });
    expect(proof.outputs).toEqual({ passed: "${{ steps.proof.outputs.passed }}" });
  });

  function prove(file: string, runs: Array<{ path: string }> | "error") {
    const proofStep = defined(defined(workflow(file).jobs["queue-proof"]).steps?.find((step) => step.id === "proof"));
    const dir = mkdtempSync(join(scratch, "proof-"));
    const calls = join(dir, "calls");
    const output = join(dir, "github-output");
    writeFileSync(output, "");
    writeFileSync(join(dir, "runs.json"), JSON.stringify({ workflow_runs: runs === "error" ? [] : runs }));
    writeFileSync(
      join(dir, "gh"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\n[ "${runs === "error" ? 1 : 0}" = 0 ] || exit 1\ncat "${join(dir, "runs.json")}"\n`,
    );
    chmodSync(join(dir, "gh"), 0o755);
    const result = spawnSync("bash", ["-e", "-c", defined(proofStep.run)], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        REPO: "Singularityszn/pubmax",
        WORKFLOW_REF: `Singularityszn/pubmax/.github/workflows/${file}@refs/heads/main`,
        SHA: "abc123",
        GITHUB_OUTPUT: output,
      },
    });
    return { result, output: readFileSync(output, "utf8").trim(), calls: readFileSync(calls, "utf8").trim() };
  }

  describe.each(FILES)("%s queue proof", (file) => {
    const otherPath = `.github/workflows/${file === "ci.yml" ? "e2e.yml" : "ci.yml"}`;
    it.each<{ runs: Array<{ path: string }> | "error"; passed: string }>([
      { runs: [{ path: otherPath }, { path: `.github/workflows/${file}` }], passed: "true" },
      { runs: [{ path: otherPath }], passed: "false" },
      { runs: [], passed: "false" },
      { runs: "error", passed: "false" },
    ])("proves a commit only by a green queue run of the same workflow: $runs", ({ runs, passed }) => {
      const { result, output, calls } = prove(file, runs);
      expect(result.status, result.stderr).toBe(0);
      expect(output).toBe(`passed=${passed}`);
      expect(calls).toBe("api repos/Singularityszn/pubmax/actions/runs?event=merge_group&status=success&head_sha=abc123&per_page=100");
      if (runs === "error") expect(result.stdout).toContain("::warning::");
    });
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
