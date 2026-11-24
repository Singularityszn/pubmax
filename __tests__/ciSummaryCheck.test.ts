import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { browserJobCondition, browserJobExpression, browserJobName } from "@/scripts/ci/githubExpressions";
import { defined } from "@/__tests__/helpers/defined";
import { ReleaseRefusal, freshnessPreflight } from "@/scripts/lib/releaseProduction.mjs";

type Step = { name?: string; id?: string; run?: string; steps?: Step[] };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

function workflow(file: string): Workflow {
  return parse(readFileSync(join(process.cwd(), ".github/workflows", file), "utf8")) as Workflow;
}

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

describe("the required summary command", () => {
  const run = defined(defined(workflow("ci.yml").jobs.check).steps?.[0]?.run, "summary run");
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
    const needs = Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]));
    const result = spawnSync("bash", ["-e", "-c", run], {
      encoding: "utf8", env: { ...process.env, NEEDS: JSON.stringify(needs) },
    });
    expect(result.status, result.stderr).toBe(status);
    for (const [job, outcome] of Object.entries(results)) expect(result.stdout).toContain(`${job}: ${outcome}`);
    if (status !== 0) expect(result.stdout).toContain("::error::Not green:");
  });
});

describe("the merge queue proof command", () => {
  const scratch = mkdtempSync(join(tmpdir(), "pubmax-queue-proof-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  describe.each(["ci.yml", "e2e.yml", "rls-session.yml", "security-ci.yml"])("%s queue proof", (file) => {
    const otherPath = `.github/workflows/${file === "ci.yml" ? "e2e.yml" : "ci.yml"}`;
    it.each<{ runs: Array<{ path: string }> | "error"; passed: string }>([
      { runs: [{ path: otherPath }, { path: `.github/workflows/${file}` }], passed: "true" },
      { runs: [{ path: otherPath }], passed: "false" },
      { runs: [], passed: "false" },
      { runs: "error", passed: "false" },
    ])("proves a commit only by a green queue run of the same workflow: $runs", ({ runs, passed }) => {
      const proofStep = defined(defined(workflow(file).jobs["queue-proof"]).steps?.find((step) => step.id === "proof"));
      const dir = mkdtempSync(join(scratch, "proof-"));
      const output = join(dir, "output");
      const calls = join(dir, "calls");
      writeFileSync(output, "");
      writeFileSync(join(dir, "runs.json"), JSON.stringify({ workflow_runs: runs === "error" ? [] : runs }));
      writeFileSync(join(dir, "gh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\n[ "${runs === "error" ? 1 : 0}" = 0 ] || exit 1\ncat "${join(dir, "runs.json")}"\n`);
      chmodSync(join(dir, "gh"), 0o755);
      const result = spawnSync("bash", ["-e", "-c", defined(proofStep.run)], {
        encoding: "utf8", env: {
          ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, REPO: "Singularityszn/pubmax",
          WORKFLOW_REF: `Singularityszn/pubmax/.github/workflows/${file}@refs/heads/main`, SHA: "abc123", GITHUB_OUTPUT: output,
        },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(output, "utf8").trim()).toBe(`passed=${passed}`);
      expect(readFileSync(calls, "utf8").trim()).toBe("api repos/Singularityszn/pubmax/actions/runs?event=merge_group&status=success&head_sha=abc123&per_page=100");
      if (runs === "error") expect(result.stdout).toContain("::warning::");
    });
  });
});

describe("the freshness gate commands", () => {
  const parsed = workflow("freshness.yml");
  const expectedCommands = ["node scripts/check_freshness.mjs --artifacts-only", "node scripts/check-production-store-freshness.mjs"];
  const scratch = mkdtempSync(join(tmpdir(), "pubmax-freshness-ci-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const detection = defined(parsed.jobs["change-scope"]);
  const classify = defined(detection.steps?.find((step) => step.id === "scope"));
  const freshness = defined(parsed.jobs.freshness);

  function git(repo: string, ...args: string[]): string {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  }

  function classifyChange(repo: string, event: string, base = "", head = "") {
    const output = join(repo, "github-output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-e", "-c", defined(classify.run)], {
      cwd: repo, encoding: "utf8", env: { ...process.env, EVENT_NAME: event, BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output },
    });
    return { ...result, output: readFileSync(output, "utf8") };
  }

  const changes = [
    { path: "data/new.json", run: true }, { path: "public/data/new.json", run: true },
    { path: "data/freshness_registry.json", run: true }, { path: "data/feed.csv", run: true },
    { path: "docs/readme.md", run: false }, { path: "scripts/check_freshness.mjs", run: false },
    { path: "scripts/check-production-store-freshness.mjs", run: false }, { path: ".github/workflows/freshness.yml", run: false },
    { path: "data-other/feed.json", run: false }, { path: "public/database.json", run: false },
    { path: "data/existing.json", moveTo: "docs/moved.json", run: true },
    { path: "public/data/existing.json", remove: true, run: true }, { path: "", run: false },
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
      } else if (remove) git(repo, "rm", path);
      else if (path) {
        mkdirSync(join(repo, path, ".."), { recursive: true });
        writeFileSync(join(repo, path), "changed\n");
      }
      const head = commit();
      if (event === "merge_group") {
        writeFileSync(join(repo, "data/unrelated.json"), "later\n");
        commit();
        const fetch = defined(detection.steps?.find((step) => step.name === "Fetch the queue range"));
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
  it.each([undefined, "scripts/check_freshness.mjs", "scripts/check-production-store-freshness.mjs"])("executes both workflow commands and stops on %s failure", (failedScript) => {
    const bin = mkdtempSync(join(scratch, "bin-"));
    const log = join(bin, "calls");
    writeFileSync(join(bin, "node"), '#!/bin/sh\nprintf "node %s\\n" "$*" >> "$COMMAND_LOG"\n[ "$1" != "$FAIL_SCRIPT" ]\n');
    chmodSync(join(bin, "node"), 0o755);
    const script = (freshness.steps ?? []).flatMap((step) => step.run ? [step.run] : []).join("\n");
    const result = spawnSync("bash", ["-e", "-c", script], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, COMMAND_LOG: log, FAIL_SCRIPT: failedScript ?? "" },
    });
    expect(result.status, result.stderr).toBe(failedScript ? 1 : 0);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(failedScript === "scripts/check_freshness.mjs" ? expectedCommands.slice(0, 1) : expectedCommands);
  });
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
