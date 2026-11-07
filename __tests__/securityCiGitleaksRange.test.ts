// WHICH COMMITS GITLEAKS READS, BY EVENT (docs/CI_RUNBOOK.md, "Security CI is
// advisory").
//
// A push to main once scanned every ref, so a finding on an unmerged branch
// turned main red on every push and the colour of main meant nothing. A push
// now reads only the commits it added, and the weekly and manual runs still
// read every ref. The step is EXECUTED here, in a real git repository, with a
// stand-in `gitleaks` that prints the range it was given.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { defined } from "@/__tests__/helpers/defined";

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Workflow = { jobs: Record<string, { steps: Step[] }> };

const workflow = parse(
  readFileSync(join(process.cwd(), ".github/workflows/security-ci.yml"), "utf8"),
) as Workflow;
const gitleaksStep = defined(
  defined(workflow.jobs.gitleaks, "gitleaks job").steps.find((step) => step.name === "gitleaks"),
  "gitleaks step",
);
const RUN = defined(gitleaksStep.run, "gitleaks run");

const scratch = mkdtempSync(join(tmpdir(), "pubmax-gitleaks-range-"));
const repo = join(scratch, "repo");
const bin = join(scratch, "bin");
const commits: Record<"base" | "pushed" | "sibling", string> = { base: "", pushed: "", sibling: "" };

function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(message: string): string {
  writeFileSync(join(repo, "file.txt"), `${message}\n`);
  git("add", "file.txt");
  git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  mkdirSync(bin, { recursive: true });
  git("init", "-q", "-b", "main");
  commits.base = commit("base");
  commits.pushed = commit("pushed");
  // A commit that is not an ancestor of the pushed head, as a force push leaves.
  git("checkout", "-q", "-b", "other", commits.base);
  commits.sibling = commit("sibling");
  git("checkout", "-q", "main");
  writeFileSync(join(bin, "gitleaks"), '#!/bin/sh\nfor arg in "$@"; do printf "%s\\n" "$arg"; done\n');
  chmodSync(join(bin, "gitleaks"), 0o755);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function logOptsFor(env: { EVENT_NAME: string; PUSH_BEFORE?: string; PUSH_AFTER?: string }): string {
  const result = spawnSync("bash", ["-c", RUN], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PUSH_BEFORE: "",
      PUSH_AFTER: commits.pushed,
      ...env,
    },
  });
  expect(result.status, result.stderr).toBe(0);
  const args = result.stdout.split("\n");
  expect(args).toContain("--redact");
  const configIndex = args.indexOf("--config");
  expect(configIndex).toBeGreaterThanOrEqual(0);
  expect(args[configIndex + 1]).toBe(".gitleaks.toml");
  const opts = args.find((line) => line.startsWith("--log-opts="));
  return defined(opts, `log opts in ${result.stdout}`).slice("--log-opts=".length);
}

describe("the gitleaks step", () => {
  it("maps the event and push SHAs into the step environment", () => {
    expect(gitleaksStep.env).toEqual({
      EVENT_NAME: "${{ github.event_name }}",
      PUSH_BEFORE: "${{ github.event.before }}",
      PUSH_AFTER: "${{ github.sha }}",
    });
  });

  it("scans a pull request head's complete history", () => {
    expect(logOptsFor({ EVENT_NAME: "pull_request" })).toBe("--full-history HEAD");
  });

  it("scans only the commits a push to main added", () => {
    expect(logOptsFor({ EVENT_NAME: "push", PUSH_BEFORE: commits.base })).toBe(
      `--full-history ${commits.base}..${commits.pushed}`,
    );
  });

  it.each([
    ["the branch is new", "0000000000000000000000000000000000000000"],
    ["the previous head is not in the clone", "1234567890abcdef1234567890abcdef12345678"],
  ])("scans the pushed head's complete history when %s", (_, before) => {
    expect(logOptsFor({ EVENT_NAME: "push", PUSH_BEFORE: before })).toBe(
      `--full-history ${commits.pushed}`,
    );
  });

  it("scans only the pushed range after a force push", () => {
    expect(logOptsFor({ EVENT_NAME: "push", PUSH_BEFORE: commits.sibling })).toBe(
      `--full-history ${commits.sibling}..${commits.pushed}`,
    );
  });

  it.each(["schedule", "workflow_dispatch"])("scans every ref on a %s run", (event) => {
    expect(logOptsFor({ EVENT_NAME: event })).toBe("--full-history --all");
  });
});
