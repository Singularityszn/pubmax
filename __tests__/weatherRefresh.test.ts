import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
    const rootDir = mkdtempSync(join(tmpdir(), "weather-review-"));
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
    expect(calls).toContainEqual(["git", "push", "--set-upstream", "origin", "weather-cache/latest"]);
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
    expect(calls.some((call) => call[0] === "gh" && call[2] === "create")).toBe(false);
    // The switch rewrote the file with the branch's older snapshot; this run's bytes win.
    expect(staged()).toBe("fresh refresh");
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
