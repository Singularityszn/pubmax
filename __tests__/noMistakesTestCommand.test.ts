// THE NO-MISTAKES TEST STEP RUNS THE MERGE BAR ITSELF, NOT THROUGH AN AGENT.
//
// With no `commands.test` in `.no-mistakes.yaml`, the pipeline handed the whole
// Test step to one agent turn capped at 30 minutes, and on 12 and 13 September
// 2026 that turn timed out twice. The repository command now runs first, as a
// plain shell baseline with no agent cap, so the evidence agent that follows
// never has to walk the suite itself.
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
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

type RepoConfig = { commands?: { prepare?: string; test?: string } };

function repoConfig(): RepoConfig {
  return parse(readFileSync(join(ROOT, ".no-mistakes.yaml"), "utf8")) ?? {};
}

function packageScripts(): Record<string, string> {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
}

// Splits the leading `NAME=value` assignments a POSIX shell applies to the
// command's environment from the command they apply to.
function splitTestCommand(): { env: Record<string, string>; command: string } {
  const words = (repoConfig().commands?.test ?? "").trim().split(/\s+/).filter(Boolean);
  const env: Record<string, string> = {};
  while (words.length > 0 && /^[A-Z_][A-Z0-9_]*=\S*$/.test(defined(words[0]))) {
    const [name, ...value] = words.shift()!.split("=");
    env[defined(name)] = value.join("=");
  }
  return { env, command: words.join(" ") };
}

// Expands every `npm run <script>` into the text it runs, so the fence judges
// what the step executes rather than the name it was given.
function expand(command: string, scripts: Record<string, string>, seen: string[] = []): string {
  return command.replace(/npm run ([\w:.-]+)/g, (_, name: string) => {
    if (seen.includes(name)) throw new Error(`script cycle through ${name}`);
    const body = scripts[name];
    if (body === undefined) throw new Error(`commands.test names a missing script: ${name}`);
    return expand(body, scripts, [...seen, name]);
  });
}

describe("the no-mistakes repository test command", () => {
  it("installs dependencies from the lockfile before a configured command", () => {
    const prepare = repoConfig().commands?.prepare ?? "";
    expect(prepare.trim().split(/\s+/).slice(0, 2)).toEqual(["npm", "ci"]);
  });

  it("runs the pre-push merge bar", () => {
    expect(splitTestCommand().command).toBe("npm run verify:no-mistakes");
  });

  it("reaches the unit suite and never the browser suite", () => {
    const expanded = expand(splitTestCommand().command, packageScripts());

    expect(expanded).toContain("node scripts/run-coverage.mjs");
    const [unit] = coverageRuns([]);
    expect(defined(unit).args.slice(0, 3)).toEqual(["run", "--coverage", "--maxWorkers=4"]);
    // The browser suite runs in the merge bar's own e2e workflow.
    expect(expanded).not.toMatch(/playwright/);
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
    const expanded = expand(splitTestCommand().command, packageScripts());
    const env: Record<string, string> = {};
    for (const word of expanded.trim().split(/\s+/).filter(Boolean)) {
      if (!/^[A-Z_][A-Z0-9_]*=\S*$/.test(word)) break;
      const [name, ...value] = word.split("=");
      env[defined(name)] = value.join("=");
    }
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
});
