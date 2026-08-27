import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/version/route";

describe("deployment version route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prevents the marker from being cached", async () => {
    const response = GET();
    const body = await response.json();

    expect(body).toHaveProperty("deploymentId");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  });

  it("publishes the exact Vercel Git commit for release verification", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "35ffa6d40ed451b9911b0c06cd473abcab534e36");

    const response = GET();

    await expect(response.json()).resolves.toMatchObject({
      commitSha: "35ffa6d40ed451b9911b0c06cd473abcab534e36",
    });
  });

  it("does not invent a commit when deployment metadata is absent", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("GITHUB_SHA", "");

    const response = GET();

    await expect(response.json()).resolves.toMatchObject({ commitSha: null });
  });
});
