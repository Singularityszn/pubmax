import { describe, expect, it } from "vitest";

// @ts-expect-error Dependency-free Node refresh helper has no declaration file.
import { conditionForCode, publishWeatherReview, weatherBranchName } from "@/scripts/refresh_weather_snapshots.mjs";

describe("scheduled weather refresh", () => {
  it("maps route-relevant WMO conditions without calling the provider", () => {
    expect(conditionForCode(0)).toBe("Clear");
    expect(conditionForCode(61)).toBe("Rain");
    expect(conditionForCode(95)).toBe("Thunderstorm");
  });

  it("uses collision-safe review branch names", () => {
    expect(weatherBranchName(new Date("2026-07-16T14:15:00.000Z"), "123", "2")).toBe("weather-cache/20260716-123-2");
  });
});

describe("weather review handoff", () => {
  const blocked = Object.assign(new Error("Command failed: gh pr create"), {
    stderr: "pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)",
  });

  function recorder(ghError?: Error) {
    const calls: string[][] = [];
    const runCommand = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      if (command === "gh" && ghError) throw ghError;
      return "";
    };
    return { calls, runCommand };
  }

  it("pushes the branch and opens a review PR", () => {
    const { calls, runCommand } = recorder();
    const result = publishWeatherReview({ branch: "weather-cache/20261029-1-1", stamp: "20261029", runCommand, log: () => {} });
    expect(result).toEqual({ status: "created", branch: "weather-cache/20261029-1-1" });
    expect(calls.map((call) => call.slice(0, 2).join(" "))).toEqual(["git checkout", "git add", "git commit", "git push", "gh pr"]);
  });

  it("hands the pushed branch to a human when Actions may not open PRs", () => {
    const { calls, runCommand } = recorder(blocked);
    const lines: string[] = [];
    const result = publishWeatherReview({
      branch: "weather-cache/20261029-1-1",
      stamp: "20261029",
      env: { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "Singularityszn/pubmax" },
      runCommand,
      log: (line: string) => lines.push(line),
    });
    expect(calls.some((call) => call[0] === "git" && call[1] === "push")).toBe(true);
    expect(result).toEqual({
      status: "branch-only",
      branch: "weather-cache/20261029-1-1",
      branchUrl: "https://github.com/Singularityszn/pubmax/tree/weather-cache/20261029-1-1",
    });
    expect(lines.join("\n")).toMatch(/^::warning::.*weather-cache\/20261029-1-1/);
  });

  it("still fails on any other gh error", () => {
    const { runCommand } = recorder(new Error("gh: not authenticated"));
    expect(() => publishWeatherReview({ branch: "b", stamp: "20261029", runCommand, log: () => {} })).toThrow(/not authenticated/);
  });
});
