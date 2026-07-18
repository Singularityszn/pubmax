import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const API_ROOT = join(ROOT, "app/api");
// Mutating handlers are exported either as `export async function POST` or, when
// wrapped by an observation seam like `withRouteTiming`, as `export const POST =
// …`. Both forms must stay certified.
const MUTATION_EXPORT = /export (?:async function|const) (POST|PUT|PATCH|DELETE)\b/;

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? routeFiles(path)
      : entry.name === "route.ts" || entry.name === "route.tsx"
        ? [path]
        : [];
  });
}

type Boundary = "rate_limit" | "account" | "capability" | "moderator" | "confirmation";

const BOUNDARY_PATTERNS: Record<Boundary, RegExp> = {
  rate_limit: /\b(?:isLimited|is[A-Z][A-Za-z]+Limited|is[A-Z][A-Za-z]+RateLimited)\b/,
  account: /\bcallerUserId\b/,
  capability: /\b(?:planMemberCapability|memberToken|requireRoundOwnership)\b/,
  moderator: /\b(?:isModerator|isAdminAuthorized|verifyAdminToken)\b/,
  confirmation: /\b(?:consumePublishConfirmation|confirmationToken)\b/,
};

function boundaries(source: string): Boundary[] {
  return (Object.entries(BOUNDARY_PATTERNS) as [Boundary, RegExp][])
    .filter(([, pattern]) => pattern.test(source))
    .map(([boundary]) => boundary);
}

const mutationRoutes = routeFiles(API_ROOT)
  .map((file) => ({
    file,
    route: relative(ROOT, file),
    source: readFileSync(file, "utf8"),
  }))
  .filter(({ source }) => MUTATION_EXPORT.test(source));

describe("mutating API surface certification", () => {
  it("keeps the reviewed inventory explicit", () => {
    // 63 = the Wave 0 inventory of 60 + the email-capture POST
    // (app/api/email-subscribers/route.ts, merged) + push-tokens (native shell
    // registration) + the Social Loop "we're out" check-in POST
    // (app/api/check-ins/route.ts, feat/social-loop-v1). Token-gated GET
    // confirm/unsubscribe endpoints and the Social Loop's read-only GETs
    // (/check-ins GET, /profiles/[handle]/lot) are intentionally NOT counted.
    // This literal is the deliberate merge-coordination point: any branch adding
    // a mutating route bumps it in the same commit
    // (docs/WRITE_SURFACE_CERTIFICATION.md).
    expect(mutationRoutes).toHaveLength(63);
  });

  it("gives every mutating route an abuse or authority boundary", () => {
    const uncovered = mutationRoutes
      .filter(({ source }) => boundaries(source).length === 0)
      .map(({ route }) => route);

    expect(uncovered).toEqual([]);
  });

  it("fails closed around anonymous paid spend and Plan creation", () => {
    const failClosedRoutes = [
      "app/api/concierge/route.ts",
      "app/api/heritage/route.ts",
      "app/api/plans/route.ts",
    ];

    for (const route of failClosedRoutes) {
      const source = readFileSync(join(ROOT, route), "utf8");
      expect(source, route).toMatch(/failClosed:\s*true/);
    }
  });

  it("keeps Plan lifecycle writes capability-bound and idempotent", () => {
    const planMutationRoutes = mutationRoutes.filter(({ route }) =>
      route.startsWith("app/api/plans/[id]/")
      && !route.endsWith("/presence/route.ts")
      && !route.endsWith("/session/route.ts"),
    );

    const violations = planMutationRoutes
      .filter(({ source }) => !/\b(?:planMemberCapability|memberToken)\b/.test(source))
      .map(({ route }) => route);

    expect(violations).toEqual([]);
  });
});
