import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defined } from "@/__tests__/helpers/defined";

// @ts-expect-error Dependency-free Node refresh helper has no declaration file.
import { WEATHER_REVIEW_BRANCH, conditionForCode, publishWeatherReview } from "@/scripts/refresh_weather_snapshots.mjs";

describe("scheduled weather refresh", () => {
  it("maps route-relevant WMO conditions without calling the provider", () => {
    expect(conditionForCode(0)).toBe("Clear");
    expect(conditionForCode(61)).toBe("Rain");
    expect(conditionForCode(95)).toBe("Thunderstorm");
  });

  it("publishes every run to one stable review branch, never a dated one", () => {
    expect(WEATHER_REVIEW_BRANCH).toBe("weather-cache/latest");
  });
});

describe("weather review handoff", () => {
  const ENV = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "Singularityszn/pubmax" };
  const blocked = Object.assign(new Error("Command failed: gh pr create"), {
    stderr: "pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)",
  });
  const temporaryDirs: string[] = [];

  afterEach(() => {
    for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fixture() {
    const rootDir = mkdtempSync(join(process.cwd(), ".weather-review-"));
    temporaryDirs.push(rootDir);
    const outPath = join(rootDir, "public/data/weather/latest.json");
    mkdirSync(join(rootDir, "public/data/weather"), { recursive: true });
    writeFileSync(outPath, "fresh refresh");
    return { rootDir, outPath };
  }

  type Script = {
    remoteBranch?: boolean;
    staged?: boolean;
    openPullRequests?: Array<{ number: number; url: string }>;
    createError?: Error;
  };

  function recorder(outPath: string, script: Script = {}) {
    const calls: string[][] = [];
    let stagedContent = "";
    const runCommand = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      if (command === "git" && args[0] === "ls-remote") {
        return script.remoteBranch ? `abc\trefs/heads/${WEATHER_REVIEW_BRANCH}\n` : "";
      }
      if (command === "git" && args[0] === "rev-parse") return "abc\n";
      if (command === "git" && args[0] === "switch") {
        writeFileSync(outPath, "previous branch snapshot");
        return "";
      }
      if (command === "git" && args[0] === "add") stagedContent = readFileSync(outPath, "utf8");
      if (command === "git" && args[0] === "diff" && script.staged !== false) throw new Error("changes are staged");
      if (command === "gh" && args[1] === "list") return JSON.stringify(script.openPullRequests ?? []);
      if (command === "gh" && args[1] === "create") {
        if (script.createError) throw script.createError;
        return "https://github.com/Singularityszn/pubmax/pull/9001\n";
      }
      return "";
    };
    const verbs = () => calls.map((call) => call.slice(0, 2).join(" "));
    return { calls, runCommand, verbs, staged: () => stagedContent };
  }

  it("creates the stable branch and opens its review PR", () => {
    const { rootDir, outPath } = fixture();
    const { calls, runCommand, verbs, staged } = recorder(outPath);
    const result = publishWeatherReview({ stamp: "20261107", env: ENV, rootDir, outPath, runCommand, log: () => {} });
    expect(result).toEqual({
      status: "created",
      branch: "weather-cache/latest",
      pullRequestUrl: "https://github.com/Singularityszn/pubmax/pull/9001",
    });
    expect(verbs()).toEqual([
      "git restore",
      "git ls-remote",
      "git switch",
      "git add",
      "git diff",
      "git commit",
      "git push",
      "gh pr",
      "gh pr",
    ]);
    expect(calls).toContainEqual(["git", "switch", "--create", "weather-cache/latest"]);
    expect(calls).toContainEqual(["git", "push", "--set-upstream", "--force-with-lease=refs/heads/weather-cache/latest:", "origin", "weather-cache/latest"]);
    const create = defined(calls.find((call) => call[0] === "gh" && call[2] === "create"));
    expect(create[create.indexOf("--body") + 1]).toContain(
      "The captain approved one reused weather-cache/latest branch with one PR as the route that lands the refresh on main through the required checks.",
    );
    expect(staged()).toBe("fresh refresh");
  });

  it("adds this run to the existing branch and its open PR instead of a new branch", () => {
    const { rootDir, outPath } = fixture();
    const { calls, runCommand, staged } = recorder(outPath, {
      remoteBranch: true,
      openPullRequests: [{ number: 42, url: "https://github.com/Singularityszn/pubmax/pull/42" }],
    });
    const result = publishWeatherReview({ stamp: "20261107", env: ENV, rootDir, outPath, runCommand, log: () => {} });
    expect(result).toEqual({
      status: "updated",
      branch: "weather-cache/latest",
      pullRequestUrl: "https://github.com/Singularityszn/pubmax/pull/42",
    });
    expect(calls).toContainEqual(["git", "switch", "--force-create", "weather-cache/latest", "origin/weather-cache/latest"]);
    expect(calls).toContainEqual(["git", "push", "--set-upstream", "--force-with-lease=refs/heads/weather-cache/latest:abc", "origin", "weather-cache/latest"]);
    expect(calls.some((call) => call[0] === "gh" && call[2] === "create")).toBe(false);
    // The switch rewrote the file with the branch's older snapshot; this run's bytes win.
    expect(staged()).toBe("fresh refresh");
  });

  it.each([
    { existing: true, race: "delete" },
    { existing: true, race: "update" },
    { existing: false, race: "create" },
    { existing: true, race: "none" },
    { existing: false, race: "none" },
  ] as const)("guards real Git publication with existing=$existing and race=$race", ({ existing, race }) => {
    const base = mkdtempSync(join(process.cwd(), ".weather-publication-"));
    temporaryDirs.push(base);
    const rootDir = join(base, "worker");
    const remote = join(base, "origin.git");
    mkdirSync(rootDir);
    const env = {
      ...ENV,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "0",
      GIT_DIR: join(rootDir, ".git"),
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: join(rootDir, ".git/index"),
      GIT_AUTHOR_NAME: "Weather Test",
      GIT_AUTHOR_EMAIL: "weather@example.test",
      GIT_COMMITTER_NAME: "Weather Test",
      GIT_COMMITTER_EMAIL: "weather@example.test",
    };
    const git = (args: string[]) => execFileSync("git", [
      "-c", `core.hooksPath=${devNull}`, "-c", "commit.gpgSign=false", ...args,
    ], { cwd: rootDir, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git([`--git-dir=${remote}`, "init", "--bare", "--quiet"]);
    git(["init", "--quiet", "--initial-branch=main"]);
    git(["remote", "add", "origin", remote]);
    const outPath = join(rootDir, "latest.json");
    writeFileSync(outPath, "main snapshot");
    git(["add", "latest.json"]);
    git(["commit", "--quiet", "-m", "main snapshot"]);
    git(["push", "--quiet", "origin", "main"]);
    const main = git(["rev-parse", "HEAD"]).trim();
    const ref = "refs/heads/weather-cache/latest";
    if (existing) {
      git(["switch", "--quiet", "--create", "weather-cache/latest"]);
      writeFileSync(outPath, "previous snapshot");
      git(["commit", "--quiet", "-am", "previous snapshot"]);
      git(["push", "--quiet", "origin", "weather-cache/latest"]);
      git(["switch", "--quiet", "main"]);
    }
    writeFileSync(outPath, "fresh refresh");
    const pullRequestCalls: string[][] = [];
    const publish = () => publishWeatherReview({
      stamp: "20261107", env, rootDir, outPath, log: () => {},
      runCommand: (command: string, args: string[]) => {
        if (command === "gh") {
          pullRequestCalls.push(args);
          return args[1] === "list" ? "[]" : "https://example.test/pull/1";
        }
        if (args[0] === "push") {
          if (race === "delete") git([`--git-dir=${remote}`, "update-ref", "-d", ref]);
          if (race === "update" || race === "create") git([`--git-dir=${remote}`, "update-ref", ref, main]);
        }
        return git(args);
      },
    });

    if (race !== "none") {
      expect(publish).toThrow(/stale info/);
      expect(pullRequestCalls).toEqual([]);
      const remoteHead = git(["ls-remote", "--heads", "origin", ref]).trim();
      expect(remoteHead).toBe(race === "delete" ? "" : `${main}\t${ref}`);
    } else {
      expect(publish()).toMatchObject({ status: "created" });
      expect(git([`--git-dir=${remote}`, "show", `${ref}:latest.json`])).toBe("fresh refresh");
      if (existing) expect(git(["rev-list", "--count", `main..${ref}`]).trim()).toBe("2");
      expect(pullRequestCalls).toHaveLength(2);
    }
  });

  it("pushes nothing when the branch already holds this snapshot", () => {
    const { rootDir, outPath } = fixture();
    const { calls, runCommand } = recorder(outPath, { remoteBranch: true, staged: false });
    const result = publishWeatherReview({ stamp: "20261107", env: ENV, rootDir, outPath, runCommand, log: () => {} });
    expect(result).toEqual({ status: "no-change", branch: "weather-cache/latest" });
    expect(calls.some((call) => call[1] === "commit" || call[1] === "push" || call[0] === "gh")).toBe(false);
  });

  it("hands the stable branch to a human when Actions may not open PRs", () => {
    const { rootDir, outPath } = fixture();
    const { calls, runCommand } = recorder(outPath, { createError: blocked });
    const lines: string[] = [];
    const result = publishWeatherReview({
      stamp: "20261107",
      env: ENV,
      rootDir,
      outPath,
      runCommand,
      log: (line: string) => lines.push(line),
    });
    expect(calls.some((call) => call[0] === "git" && call[1] === "push")).toBe(true);
    expect(result).toEqual({
      status: "branch-only",
      branch: "weather-cache/latest",
      branchUrl: "https://github.com/Singularityszn/pubmax/tree/weather-cache/latest",
    });
    expect(lines.join("\n")).toMatch(/^::warning::.*weather-cache\/latest/);
  });

  it("still fails on any other gh error", () => {
    const { rootDir, outPath } = fixture();
    const { runCommand } = recorder(outPath, { createError: new Error("gh: not authenticated") });
    expect(() =>
      publishWeatherReview({ stamp: "20261107", env: ENV, rootDir, outPath, runCommand, log: () => {} }),
    ).toThrow(/not authenticated/);
  });
});
