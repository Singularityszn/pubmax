import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/version/route";

const ORIGINAL_SHA = process.env.VERCEL_GIT_COMMIT_SHA;

afterEach(() => {
  if (ORIGINAL_SHA === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = ORIGINAL_SHA;
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
  it("names the commit the running code was built from", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "182aa88212fc58cd2d146a5c3a4a91efe4c6a1fb";

    const body = await GET().json();

    expect(body.gitCommitSha).toBe("182aa88212fc58cd2d146a5c3a4a91efe4c6a1fb");
  });

  // Nothing sets it locally or on a self-hosted run, and null is the honest
  // answer there. An empty string is the same absence and reads as one.
  it("answers null rather than guessing where no build stamped a commit", async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    expect((await GET().json()).gitCommitSha).toBeNull();

    process.env.VERCEL_GIT_COMMIT_SHA = "";
    expect((await GET().json()).gitCommitSha).toBeNull();
  });
});
