// THE NO-MISTAKES TEST STEP RUNS THE MERGE BAR ITSELF, NOT THROUGH AN AGENT.
//
// With no `commands.test` in `.no-mistakes.yaml`, the pipeline handed the whole
// Test step to one agent turn capped at 30 minutes, and on 12 and 13 September
// 2026 that turn timed out twice. The repository command now runs first, as a
// plain shell baseline with no agent cap, so the evidence agent that follows
// never has to walk the suite itself.
//
// Since 16 October 2026 that command is CHANGE-SCOPED (`verify:no-mistakes:changed`,
// scripts/verify-changed.mjs): the full unit suite runs once, in the CI unit
// shards, and the local step falls back to the full `npm run verify` only when
// the change touches a shared foundation. __tests__/verifyChanged.test.ts pins
// the plan; this file pins how the pipeline reaches it.
//
// THREE facts about the tool shape this fence. (1) A run worktree holds tracked
// files only, so `node_modules` is absent until `commands.prepare` installs it.
// (2) no-mistakes reads `commands.*` ONLY from the `origin/main` copy of the
// file, so a branch that edits this config is still tested by the old one.
// (3) The Push step commits whatever a step leaves in the worktree. `verify`
// normally rebuilds slim shards before validate-data; when the builder has
// moved ahead of what is checked in that rewrite dirties public/data. The
// command sets PUBMAX_VERIFY_COMMITTED_DATA=1 to validate committed artifacts,
// DEPLOYMENT_VERSION=local so a checkout never stamps HEAD over `local`, and
// run-with-restored-bundled-data.mjs to git-restore bundled trees on exit.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { requireDataRevision } from "@/lib/dataRevision.mjs";

import { POSTGRES_BACKED_SUITES, SERIAL_SHM_RUN } from "../scripts/rls/postgresSuites.mjs";
import { WITHOUT_POSTGRES, coverageRuns } from "../scripts/run-coverage.mjs";
import { checkSteps } from "../scripts/verify-changed.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

type RepoConfig = { commands?: { prepare?: string; test?: string }; auto_fix?: Record<string, unknown> };

function repoConfig(): RepoConfig {
  return parse(readFileSync(join(ROOT, ".no-mistakes.yaml"), "utf8")) ?? {};
}

function packageScripts(): Record<string, string> {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
}

type Command = { argv: string[]; env: Record<string, string> };

function commands(command: string, scripts: Record<string, string>, inherited: Record<string, string> = {}, seen: string[] = []): Command[] {
  return command.split("&&").flatMap((part) => {
    if (/[|;<>`$()"'\\\n]/.test(part)) throw new Error("Unsupported shell syntax in the gate command");
    const argv = part.trim().split(/\s+/).filter(Boolean);
    const env = { ...inherited };
    while (/^[A-Z_][A-Z0-9_]*=/.test(argv[0] ?? "")) {
      const [name, ...value] = argv.shift()!.split("=");
      env[defined(name)] = value.join("=");
    }
    if (argv[0] === "npm" && argv[1] === "run") {
      const name = defined(argv[2]);
      if (seen.includes(name)) throw new Error(`script cycle through ${name}`);
      const body = defined(scripts[name], `script ${name}`);
      const forwarded = argv.slice(argv[3] === "--" ? 4 : 3);
      return commands([body, ...forwarded].join(" "), scripts, env, [...seen, name]);
    }
    const call = { argv, env };
    if (argv[0] === "node" && argv[1] === "scripts/run-with-restored-bundled-data.mjs") {
      return [call, ...commands(argv.slice(2).join(" "), scripts, env, seen)];
    }
    return [call];
  });
}

describe("the no-mistakes repository test command", () => {
  it("installs dependencies from the lockfile before a configured command", () => {
    const prepare = repoConfig().commands?.prepare ?? "";
    expect(prepare.trim().split(/\s+/).slice(0, 2)).toEqual(["npm", "ci"]);
  });

  it("runs the change-scoped checks, not the whole suite a second time", () => {
    const invoked = commands(repoConfig().commands?.test ?? "", packageScripts());
    expect(invoked.map((call) => call.argv)).toContainEqual(["node", "scripts/verify-changed.mjs"]);
    expect(invoked.some((call) => call.argv[1] === "scripts/run-coverage.mjs")).toBe(false);
  });

  it("does not mistake echoed command names for executable checks", () => {
    const scripts = { ...packageScripts(), "verify:no-mistakes:changed": "echo node scripts/verify-changed.mjs", verify: "echo node scripts/run-coverage.mjs" };
    expect(commands(repoConfig().commands?.test ?? "", scripts).map((call) => call.argv[0])).toEqual(["echo"]);
    expect(commands("npm run verify", scripts).map((call) => call.argv[0])).toEqual(["echo"]);
  });

  it("falls back to the pre-push merge bar, which reaches the unit suite and never the browser suite", () => {
    const fallback = checkSteps({
      full: "package.json is a shared foundation",
      lint: [],
      typecheck: [],
      tests: [],
      rls: false,
      validateData: false,
      dbTypes: false,
      e2eSkips: false,
      chatgptMap: false,
    });
    expect(fallback.map((step) => [step.command, ...step.args].join(" "))).toEqual(["npm run verify"]);
    const scripts = packageScripts();
    const invoked = commands("npm run verify", scripts);
    expect(invoked.map((call) => call.argv)).toContainEqual(["node", "scripts/run-coverage.mjs", "--without-postgres"]);
    expect(commands("npm run verify:no-mistakes", scripts).slice(1).map((call) => call.argv))
      .toEqual(invoked.map((call) => call.argv));
    const [unit] = coverageRuns([]);
    expect(defined(unit).args.slice(0, 3)).toEqual(["run", "--coverage", "--maxWorkers=4"]);
    // The browser suite runs in the merge bar's own e2e workflow.
    expect(invoked.some((call) => call.argv[0] === "playwright" || call.argv[1] === "node_modules/@playwright/test/cli.js")).toBe(false);
  });

  it("gives forwarded CI excludes to the coverage run alone", () => {
    const exclude = ["--exclude", "__tests__/rlsSession.test.ts"];
    const [unit, serial] = coverageRuns(exclude);

    expect(defined(unit).args).toEqual(["run", "--coverage", "--maxWorkers=4", ...exclude]);
    expect(serial).toEqual({
      args: ["run", ...SERIAL_SHM_RUN.suites, "--maxWorkers=1"],
      env: SERIAL_SHM_RUN.env,
    });
  });

  it("drops the serial SysV proof when the forwarded args exclude it", () => {
    const excluded = SERIAL_SHM_RUN.suites.flatMap((suite) => ["--exclude", suite]);

    expect(coverageRuns(excluded)).toHaveLength(1);
  });

  it("leaves the PostgreSQL suites to npm run test:rls", () => {
    // verify runs those suites in `npm run test:rls`, so its coverage run
    // excludes them rather than running each one twice.
    const verify = defined(packageScripts().verify, "verify script")
      .split("&&")
      .map((command) => command.trim().split(/\s+/));
    const at = verify.findIndex((words) => words.slice(0, 3).join(" ") === "npm run coverage");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(defined(verify[at]).slice(3)).toEqual(["--", WITHOUT_POSTGRES]);
    expect(verify[at + 1]).toEqual(["npm", "run", "test:rls"]);

    const runs = coverageRuns([WITHOUT_POSTGRES, "--shard=1/2"]);
    expect(runs).toHaveLength(1);
    expect(defined(runs[0]).args).toEqual([
      "run",
      "--coverage",
      "--maxWorkers=4",
      ...POSTGRES_BACKED_SUITES.flatMap((suite) => ["--exclude", suite]),
      "--shard=1/2",
    ]);
  });

  it("validates committed bundled data without regenerating slim shards", () => {
    const invoked = commands(repoConfig().commands?.test ?? "", packageScripts());
    const env = defined(invoked.find((call) => call.argv[1] === "scripts/verify-changed.mjs")).env;
    expect(env.PUBMAX_VERIFY_COMMITTED_DATA).toBe("1");
    expect(env.DEPLOYMENT_VERSION).toBe("local");

    // Plain verify rebuilds working files first. The pipeline contract concerns
    // the committed artifact, regardless of any local builder's revision stamp.
    const committed = JSON.parse(execFileSync("git", [
      "show", "HEAD:public/data/cities/bath/venues_slim.manifest.json",
    ], { cwd: ROOT, encoding: "utf8" })).revision;
    // A run worktree is a git checkout, so git always names a HEAD there.
    const stamped = requireDataRevision(env, {
      workingTreeSha: "0123456789abcdef0123456789abcdef01234567",
    });

    expect(stamped).toBe(committed);
  });

  it("gives the Test step one real attempt and no automatic repair, beside the CI rule", () => {
    const config = repoConfig();
    expect(config.auto_fix).toEqual({ ci: 0, test: 0 });
    // A zero repair budget skips no Test. The trusted commands still run it once.
    expect(config.commands).toEqual({
      prepare: "npm ci --prefer-offline",
      test: "npm run verify:no-mistakes:changed",
    });
  });

  it("runs the full fallback with a 2 GB Node heap", () => {
    const [fallback] = checkSteps({
      full: "next.config.mjs is a shared foundation",
      lint: [],
      typecheck: [],
      tests: [],
      rls: false,
      validateData: false,
      dbTypes: false,
      e2eSkips: false,
      chatgptMap: false,
    });
    expect(defined(fallback).command).toBe("npm");
    expect(defined(fallback).args).toEqual(["run", "verify"]);
    expect(defined(fallback).env).toEqual({ NODE_OPTIONS: "--max-old-space-size=2048", VITEST_MAX_WORKERS: "1" });
  });
});
