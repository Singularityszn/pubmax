import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// A CEILING A RETRY CAN LAUNDER IS NOT A CEILING.
//
// playwright.config.ts retries once on CI. Playwright calls a test that fails
// and then passes FLAKY, and a flaky run exits 0, so the Performance budget job
// reported GREEN on main's own head (6 September 2026) over a printed breach
// table: /pubs measured 1275 KB against a 1200 ceiling and 73 requests against
// 68, retried, drew a lower sample and passed. Every pull request carrying the
// same numbers went red, which is what made it read as a push-versus-pull-
// request difference when it was a coin flip.
//
// No browser run reproduces that here, so the fence is the source: the sweep
// declares its own zero-retry policy, and the shared retry setting it opts out
// of is still in the config it opts out of.

const ROOT = process.cwd();

describe("the performance budget sweep is measured once", () => {
  it("configures zero retries for itself", () => {
    const spec = readFileSync(
      path.join(ROOT, "e2e", "performance-budget.spec.ts"),
      "utf8",
    );
    expect(spec).toContain("test.describe.configure({ retries: 0 })");
  });

  it("configures zero retries for the mobile map budget too", () => {
    const spec = readFileSync(
      path.join(ROOT, "e2e", "map-perf-budget.spec.ts"),
      "utf8",
    );
    expect(spec).toContain("test.describe.configure({ retries: 0 })");
  });

  it("still runs under a config that retries the ordinary browser suite", () => {
    const config = readFileSync(path.join(ROOT, "playwright.config.ts"), "utf8");
    expect(config).toContain("retries: process.env.CI ? 1 : 0");
  });

  it("keeps route-specific pre-paint work inside the shared head request", () => {
    const layout = readFileSync(path.join(ROOT, "app", "layout.tsx"), "utf8");
    const sharedInit = readFileSync(path.join(ROOT, "public", "theme-init.js"), "utf8");

    expect(layout).toContain('<script src="/theme-init.js?v=splash-1" />');
    expect(layout).not.toContain("/splash-init.js");
    expect(sharedInit).toContain('window.location.pathname !== "/"');
    expect(sharedInit).toContain('dataset.splash = "on"');
    expect(existsSync(path.join(ROOT, "public", "splash-init.js"))).toBe(false);
  });
});
