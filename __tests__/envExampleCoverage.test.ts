import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

/**
 * A VARIABLE THE CODE READS IS EITHER DOCUMENTED OR PLATFORM-OWNED.
 *
 * `.env.example` is the one place an operator learns what this app can be
 * configured with, and four readers had drifted out of it: `CRON_SECRET`,
 * which is the whole of the authentication on every scheduled route,
 * `ORS_API_KEY` and `ORS_DAILY_BUDGET`, and `PLAN_INVITE_TOKEN_SALT`. A
 * missing line reads as "this app has no such setting", which is how a cron
 * plane ends up deployed unprotected.
 *
 * The allowlist below is the honest other half: a name nobody sets by hand.
 * Each row says WHO sets it, because "it is not in .env.example" is a claim
 * about the deployment and not a licence to skip the question.
 */
const PLATFORM_OWNED: Record<string, string> = {
  // Set by the Node runtime and by the test runners.
  NODE_ENV: "Node runtime / test runner",
  VITEST: "vitest",
  VITEST_WORKER_ID: "vitest",
  // Set by Next.js itself during build and at runtime.
  NEXT_PHASE: "Next.js build phase marker",
  NEXT_DEPLOYMENT_ID: "Next.js deployment marker",
  NEXT_DIST_DIR: "Next.js build directory (npm scripts pass it)",
  // Set by the Vercel platform on a deployment.
  VERCEL_ENV: "Vercel platform",
  VERCEL_DEPLOYMENT_ID: "Vercel platform",
  // Injected by next.config.mjs from lib/buildInfo.mjs at build time.
  PUBMAX_BUILD_COMMIT_SHA: "next.config.mjs env, from lib/buildInfo.mjs",
  PUBMAX_BUILD_COMMIT_SHA_SOURCE: "next.config.mjs env, from lib/buildInfo.mjs",
  PUBMAX_BUILD_TIME: "next.config.mjs env, from lib/buildInfo.mjs",
  // Injected by next.config.mjs from lib/analyticsAttribution.mjs at build time.
  PUBMAX_ANALYTICS_ENVIRONMENT: "next.config.mjs env, from lib/analyticsAttribution.mjs",
  // Set by the Playwright harness (playwright.config.ts webServer.env).
  PW_NEXT_DIST_DIR: "playwright.config.ts",
  PW_SCREENSHOTS: "playwright.config.ts (screenshot runs)",
  NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "playwright.config.ts webServer.env",
  PUBMAX_E2E_RATE_LIMIT_MAX:
    "playwright.config.ts webServer.env (test-only limiter allowance)",
  // Test seam: redirects the generated venue-detail read at a fixture tree.
  PUBMAX_VENUE_DETAIL_DIR: "test seam (lib/venueDetailIndex.ts)",
};

const ENV_READ = /process\.env\.([A-Z0-9_]+)|process\.env\[\s*"([A-Z0-9_]+)"\s*\]/g;

function sourceFiles(...roots: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(process.cwd(), dir))) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const rel = `${dir}/${entry}`;
      if (statSync(join(process.cwd(), rel)).isDirectory()) {
        walk(rel);
        continue;
      }
      if (/\.(ts|tsx|mjs)$/.test(entry)) found.push(rel);
    }
  };
  for (const root of roots) walk(root);
  return found;
}

function documentedNames(): Set<string> {
  const source = readFileSync(join(process.cwd(), ".env.example"), "utf8");
  const names = new Set<string>();
  for (const line of source.split("\n")) {
    const match = /^([A-Z0-9_]+)=/.exec(line.trim());
    if (match) names.add(defined(match[1]));
  }
  return names;
}

describe("every env var app/ and lib/ read is documented or platform-owned", () => {
  it("names the four readers the audit found missing", () => {
    const documented = documentedNames();
    for (const name of [
      "CRON_SECRET",
      "ORS_API_KEY",
      "ORS_DAILY_BUDGET",
      "PLAN_INVITE_TOKEN_SALT",
    ]) {
      expect(documented.has(name)).toBe(true);
    }
  });

  it("each documented variable's comment names its reader", () => {
    const source = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(source).toMatch(/lib\/cronAuth\.ts[\s\S]*?\nCRON_SECRET=/);
    expect(source).toMatch(/lib\/walkRouteProvider\.ts[\s\S]*?\nORS_API_KEY=/);
    expect(source).toMatch(/lib\/walkRouteBudget\.ts[\s\S]*?\nORS_DAILY_BUDGET=/);
    expect(source).toMatch(
      /lib\/planCollaborationStore\.ts[\s\S]*?\nPLAN_INVITE_TOKEN_SALT=/,
    );
  });

  it("finds no undocumented reader outside the platform-owned allowlist", () => {
    const documented = documentedNames();
    const offenders = new Map<string, string[]>();
    for (const file of sourceFiles("app", "lib")) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      for (const match of source.matchAll(ENV_READ)) {
        const name = match[1] ?? match[2];
        if (!name) continue;
        if (documented.has(name)) continue;
        if (name in PLATFORM_OWNED) continue;
        const seen = offenders.get(name) ?? [];
        if (!seen.includes(file)) seen.push(file);
        offenders.set(name, seen);
      }
    }
    expect(Object.fromEntries(offenders)).toEqual({});
  });

  it("keeps the allowlist honest: every row is still read somewhere", () => {
    const read = new Set<string>();
    for (const file of sourceFiles("app", "lib")) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      for (const match of source.matchAll(ENV_READ)) {
        const name = match[1] ?? match[2];
        if (name) read.add(name);
      }
    }
    const stale = Object.keys(PLATFORM_OWNED).filter((name) => !read.has(name));
    expect(stale).toEqual([]);
  });
});
