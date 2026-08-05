import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const API_ROOT = join(ROOT, "app/api");
const CERTIFICATION = readFileSync(
  join(ROOT, "docs/WRITE_SURFACE_CERTIFICATION.md"),
  "utf8",
);
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
  account: /\b(?:callerUserId|callerAuthIdentity|verifyCallerAuth|resolveContributionIdentity)\b/,
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
  it("documents account-derived Visit Report and Recommendation identity", () => {
    const visitReports = CERTIFICATION.match(
      /### `app\/api\/visit-reports`[\s\S]*?(?=\n### )/,
    )?.[0] ?? "";
    const recommendations = CERTIFICATION.match(
      /### `app\/api\/weather-recommendations`[\s\S]*?(?=\n### |\s*$)/,
    )?.[0] ?? "";

    expect(visitReports).toMatch(
      /authenticated\s+account's immutable profile id/,
    );
    expect(visitReports).toMatch(
      /visit-report:\$\{contributor\.actor\}:\$\{ipHash\}/,
    );
    expect(visitReports).not.toMatch(/per-handle|self-asserted handle/);
    expect(recommendations).toMatch(
      /authenticated account's\s+immutable profile id/,
    );
    expect(recommendations).toMatch(/profile-based actor/);
    expect(recommendations).not.toMatch(/Keyless development|asserted handle/);
  });

  it("keeps the reviewed inventory explicit", () => {
    // 72 = the Wave 0 inventory of 60 + the email-capture POST
    // (app/api/email-subscribers/route.ts, merged) + push-tokens (native shell
    // registration) + the Social Loop "we're out" check-in POST
    // (app/api/check-ins/route.ts, feat/social-loop-v1) + the vibe-vote POST
    // (app/api/plans/[id]/vibe-votes/route.ts, feat/vibe-votes — share-loop
    // tally; its sibling GET aggregate read is NOT a mutating verb and is not
    // counted) + the area-demand capture POST (app/api/area-demand/route.ts,
    // lane/area-demand-capture — Wayfinder 3.2 honest unsupported-area preview)
    // + the structured Visit Reports POST (app/api/visit-reports/route.ts,
    // lane/visit-reports — Wayfinder 3.4; its per-venue GET summary read is NOT
    // a mutating verb and is not counted) + the author-confirmed alt-text PATCH
    // (app/api/night-moments/[id]/alt-text/route.ts, lane/alt-text-authoring —
    // Wayfinder 5.6; a PRIVATE authoring write, account-gated, not a publication)
    // + the operator rail (Wayfinder 3.5, lane/operator-rail): the venue-operator
    // claim POST (app/api/venue-operators/claim/route.ts) and the
    // operator-proposals POST (app/api/operator-proposals/route.ts) — each also
    // exports a read-only GET (own-claim / moderator queue) which is NOT a
    // mutating verb and is not counted. Token-gated GET confirm/unsubscribe
    // endpoints and the Social Loop's read-only GETs (/check-ins GET,
    // /profiles/[handle]/lot) are intentionally NOT counted. Plus the community
    // price-submission POST (app/api/price-submit/route.ts,
    // fm/price-submission): an account-gated, handle-attributed, rate-limited,
    // bounds-checked dated price observation; its sibling GET (the freshest
    // community price per drink at a venue) is NOT a mutating verb and is not
    // counted. Plus the
    // community-price moderation POST (app/api/admin/community-prices/route.ts,
    // fm/trust-quickfixes): moderator-gated hide/restore on one community price
    // - hide, never delete; its sibling GET (the review queue) is NOT a mutating
    // verb and is not counted. The reader-side FLAG shares the existing
    // price-submit POST rather than adding a route. Plus the authored weather
    // Recommendation POST (app/api/weather-recommendations/route.ts,
    // fm/weather-recommendations): account-derived handle and profile actor,
    // closed weather vocabulary, and two rate-limit tiers. Its sibling
    // GET is read-only and is not counted. This literal is the
    // + two private referral writes: account-gated invite-link creation and
    // signup-only attribution claim. Neither accepts an account id from the
    // caller, and neither exposes an invite edge. Account onboarding replaces
    // the earlier identity claim POST, so removing the superseded
    // contribution-age route returns the inventory to 74. The protected Social
    // account-migration POST adds route 75. The
    // deliberate merge-coordination point: any branch adding a mutating route
    // bumps it in the same commit (docs/WRITE_SURFACE_CERTIFICATION.md).
    expect(mutationRoutes).toHaveLength(75);
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
