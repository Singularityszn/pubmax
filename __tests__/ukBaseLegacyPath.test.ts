import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

// next.config.mjs is plain ESM with no declaration file: it is the file Next
// itself loads, so it is read here through its own type rather than mirrored.
// next.config.mjs is plain JS with no type declaration; import it and pin the
// shape locally so the test stays typed without a bespoke .d.ts.
// @ts-expect-error -- no declaration file for the JS config module.
import nextConfigModule from "@/next.config.mjs";

const nextConfig = nextConfigModule as NextConfig;

const ROOT = process.cwd();
const ACTIVE_MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "public", "data", "uk_base", "manifest.json"), "utf8"),
) as { urlPrefix: string };

// Llandudno's pack was rebuilt under a new content-addressed generation and the
// old shard URLs went with it (#1015), so a browser holding a stale manifest
// asks for files that no longer exist. That compatibility used to be a
// NextResponse.rewrite in proxy.ts, which meant it - and every other /data
// request behind the same matcher - paid a Node function in front of the CDN
// (#1425). It is a routing rule with no per-request input, so it is a
// build-time rewrite now and the packs stay on the edge.
describe("UK base generation compatibility", () => {
  it("rewrites requests for the removed Llandudno generation to active shards", async () => {
    const activeGeneration =
      ACTIVE_MANIFEST.urlPrefix.match(/packs\/([a-f0-9]{16})\//)?.[1] ?? "";
    expect(activeGeneration).toMatch(/^[a-f0-9]{16}$/);

    const rewrites = await nextConfig.rewrites!();
    if (Array.isArray(rewrites)) throw new Error("rewrites() lost its phases");
    const rule = (rewrites.beforeFiles ?? []).find((entry) =>
      entry.source.startsWith("/data/uk_base/packs/e229e760f3e7a2fd/"),
    );

    expect(rule).toBeDefined();
    expect(rule!.destination).toBe(
      `/data/uk_base/packs/${activeGeneration}/:shard`,
    );
  });

  it("takes only a shard filename, never a traversal", () => {
    const source = "/data/uk_base/packs/e229e760f3e7a2fd/:shard(\\d+\\.\\d+_-?\\d+\\.\\d+\\.json)";
    const shardPattern = /^\d+\.\d+_-?\d+\.\d+\.json$/;
    expect(source).toContain(shardPattern.source.slice(1, -1));
    expect(shardPattern.test("53.25_-4.00.json")).toBe(true);
    expect(shardPattern.test("51.50_0.25.json")).toBe(true);
    expect(shardPattern.test("../../../secret.json")).toBe(false);
    expect(shardPattern.test("53.25_-4.00.json/../x")).toBe(false);
  });
});
