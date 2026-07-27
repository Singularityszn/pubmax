// THE FRESHNESS SPINE MUST SHIP WITH ITS ARTIFACTS.
//
// Both freshness readers resolve each dataset's artifact by a path taken from
// data/freshness_registry.json and joined to process.cwd() at request time. Next
// only traces paths it can see statically, so it traces none of these, and which
// files land in a given serverless function is then an accident of how Vercel
// grouped the routes into lambdas. /api/freshness was grouped with routes that do
// statically read those files and worked; /api/cron/freshness-audit, isolated into
// its own function by `maxDuration`, shipped with no artifacts at all and reported
// every field-stamped feed as "unknown" every morning for weeks.
//
// So next.config.mjs declares them, derived from the registry rather than
// hand-copied. This fence pins that: add a dataset with an artifact and it is
// traced into both functions, or this test fails.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import registry from "@/data/freshness_registry.json";

const FRESHNESS_ROUTES = ["/api/freshness", "/api/cron/freshness-audit"] as const;

const artifacts = registry.datasets
  .map((d) => d.artifact)
  .filter((a): a is string => typeof a === "string");

// next.config.mjs is plain JS the app never type-checks, so it is loaded the way
// Next itself loads it (evaluated in Node) rather than imported. That also proves
// the config still evaluates, which a static read of the file would not.
function tracingIncludes(): Record<string, string[]> {
  const root = join(__dirname, "..");
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import(process.argv[1]);" +
        "console.log(JSON.stringify(m.default.outputFileTracingIncludes ?? null));",
      join(root, "next.config.mjs"),
    ],
    { cwd: root, encoding: "utf8" },
  );
  return JSON.parse(out) as Record<string, string[]>;
}

describe("freshness artifact tracing", () => {
  const includes = tracingIncludes();

  it("declares tracing includes for both freshness readers", () => {
    expect(includes).toBeDefined();
    for (const route of FRESHNESS_ROUTES) {
      expect(includes?.[route], `${route} must declare its artifacts`).toBeDefined();
    }
  });

  it("traces every registered artifact into every freshness function", () => {
    expect(artifacts.length).toBeGreaterThan(0);
    for (const route of FRESHNESS_ROUTES) {
      const declared = new Set(includes?.[route] ?? []);
      for (const artifact of artifacts) {
        expect(declared.has(`./${artifact}`), `${route} is missing ${artifact}`).toBe(true);
      }
    }
  });

  it("traces nothing beyond the registry, so the function stays small", () => {
    const registered = new Set(artifacts.map((a) => `./${a}`));
    for (const route of FRESHNESS_ROUTES) {
      for (const declared of includes?.[route] ?? []) {
        expect(registered.has(declared), `${route} traces unregistered ${declared}`).toBe(true);
      }
    }
  });
});
