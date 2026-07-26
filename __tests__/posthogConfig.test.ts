import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

// next.config.mjs is plain JS with no declaration file. Match existing config
// tests and pin its framework-owned shape locally.
// @ts-expect-error -- no declaration file for the JS config module.
import nextConfigModule from "@/next.config.mjs";

const nextConfig = nextConfigModule as NextConfig;

describe("PostHog EU reverse proxy", () => {
  it("keeps SDK assets and capture traffic on the app origin", async () => {
    expect(typeof nextConfig.rewrites).toBe("function");
    const rewrites = await nextConfig.rewrites!();

    expect(rewrites).toEqual([
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://eu-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ]);
    expect(nextConfig.skipTrailingSlashRedirect).toBe(true);
  });
});
