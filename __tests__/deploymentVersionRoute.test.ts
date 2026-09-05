import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/version/route";
import {
  normalizeBuildTime,
  normalizeCommitSha,
  readBuildStamp,
  resolveBuildCommit,
  resolveBuildStamp,
} from "@/lib/buildInfo.mjs";

const STAMP_KEYS = [
  "PUBMAX_BUILD_COMMIT_SHA",
  "PUBMAX_BUILD_COMMIT_SHA_SOURCE",
  "PUBMAX_BUILD_TIME",
] as const;

const ORIGINAL = Object.fromEntries(
  STAMP_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof STAMP_KEYS)[number], string | undefined>;

afterEach(() => {
  for (const key of STAMP_KEYS) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
});

const SHA = "182aa88212fc58cd2d146a5c3a4a91efe4c6a1fb";

describe("build commit resolver", () => {
  // Vercel knows the commit it checked out, so on a Git-integration build it is
  // the stronger answer and it is named as such.
  it("prefers the commit Vercel stamped, and says it came from Vercel", () => {
    expect(resolveBuildCommit({ VERCEL_GIT_COMMIT_SHA: SHA }, "0".repeat(40))).toEqual({
      commitSha: SHA,
      commitShaSource: "vercel-git",
    });
  });

  // The whole point: a CLI deploy has no VERCEL_GIT_COMMIT_SHA in the build
  // environment, and the working tree still knows which commit it is.
  it("falls back to the working tree, and says the answer came from there", () => {
    expect(resolveBuildCommit({}, `${SHA}\n`)).toEqual({
      commitSha: SHA,
      commitShaSource: "working-tree",
    });
  });

  // An empty variable and a value that is not a commit are the same absence.
  it("answers null rather than guessing where nothing named a commit", () => {
    expect(resolveBuildCommit({ VERCEL_GIT_COMMIT_SHA: "" }, null)).toEqual({
      commitSha: null,
      commitShaSource: null,
    });
    expect(resolveBuildCommit({ VERCEL_GIT_COMMIT_SHA: "main" }, "  ")).toEqual({
      commitSha: null,
      commitShaSource: null,
    });
  });

  it("keeps a short sha, because CI hands one over, and lower-cases it", () => {
    expect(normalizeCommitSha("182AA88")).toBe("182aa88");
    expect(normalizeCommitSha("182aa8")).toBeNull();
    expect(normalizeCommitSha(42)).toBeNull();
  });

  it("stamps the build time as an ISO instant", () => {
    const stamp = resolveBuildStamp({}, {
      workingTreeSha: SHA,
      now: new Date("2026-09-05T07:30:00.000Z"),
    });
    expect(stamp.builtAt).toBe("2026-09-05T07:30:00.000Z");
    expect(normalizeBuildTime("not a date")).toBeNull();
    expect(normalizeBuildTime("")).toBeNull();
  });

  // The stamp is read back out of the environment it was inlined into, so a
  // hand-set variable may not make the marker claim a commit or a source.
  it("refuses a source nobody wrote, and a source with no commit beside it", () => {
    expect(
      readBuildStamp({
        PUBMAX_BUILD_COMMIT_SHA: SHA,
        PUBMAX_BUILD_COMMIT_SHA_SOURCE: "trust-me",
      }).commitShaSource,
    ).toBeNull();
    expect(
      readBuildStamp({ PUBMAX_BUILD_COMMIT_SHA_SOURCE: "vercel-git" }).commitShaSource,
    ).toBeNull();
  });
});

describe("deployment version route", () => {
  it("prevents the marker from being cached", async () => {
    const response = GET();
    const body = await response.json();

    expect(body).toHaveProperty("deploymentId");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  });

  // A deployment id names WHICH deploy answered, never WHAT is in it. The SHA
  // rides beside it so proving "this preview serves the commit I pushed" is one
  // request rather than a trip through the Vercel API.
  it("names the commit, the source and the build time", async () => {
    process.env.PUBMAX_BUILD_COMMIT_SHA = SHA;
    process.env.PUBMAX_BUILD_COMMIT_SHA_SOURCE = "working-tree";
    process.env.PUBMAX_BUILD_TIME = "2026-09-05T07:30:00.000Z";

    const body = await GET().json();

    expect(body.gitCommitSha).toBe(SHA);
    expect(body.gitCommitShaSource).toBe("working-tree");
    expect(body.builtAt).toBe("2026-09-05T07:30:00.000Z");
  });

  // Nothing stamps a build that had no commit to name, and null is the honest
  // answer there. An empty string is the same absence and reads as one.
  it("answers null rather than guessing where no build stamped a commit", async () => {
    for (const key of STAMP_KEYS) delete process.env[key];
    let body = await GET().json();
    expect(body.gitCommitSha).toBeNull();
    expect(body.gitCommitShaSource).toBeNull();
    expect(body.builtAt).toBeNull();

    for (const key of STAMP_KEYS) process.env[key] = "";
    body = await GET().json();
    expect(body.gitCommitSha).toBeNull();
    expect(body.gitCommitShaSource).toBeNull();
    expect(body.builtAt).toBeNull();
  });

  // The defect this route is answering for: the sha was read at REQUEST time
  // from a variable Vercel sets only on a build its Git integration owns, so a
  // CLI deploy served null for ever. The build decides; the request only reports.
  it("reads no platform git variable and runs no git at request time", () => {
    const source = readFileSync(
      path.join(process.cwd(), "app/api/version/route.ts"),
      "utf8",
    );
    const code = source.replace(/\/\/[^\n]*\n/g, "\n");

    expect(code).not.toContain("VERCEL_GIT_COMMIT_SHA");
    expect(code).not.toContain("child_process");
    expect(code).not.toContain("rev-parse");
  });
});
