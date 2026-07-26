import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

// next.config.mjs is plain JS with no declaration file. Match existing config
// tests and pin its framework-owned shape locally.
// @ts-expect-error -- no declaration file for the JS config module.
import nextConfigModule from "@/next.config.mjs";

const nextConfig = nextConfigModule as NextConfig;

describe("PostHog EU reverse proxy", () => {
  it("does not bypass the owned ingest boundary with framework rewrites", () => {
    expect(nextConfig.rewrites).toBeUndefined();
    expect(nextConfig.skipTrailingSlashRedirect).toBe(true);
  });
});
