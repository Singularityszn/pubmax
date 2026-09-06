import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

// Migration 0079 stops handle claims from inheriting pre-claim contributions.
// Its own header comment states the rule; before this test the only proof was
// a regex over the migration's SQL text. This test applies the real migration
// history through PostgreSQL 16 (same harness family as socialCrewMigration.
// test.ts) and runs public_contributor_leaderboard() for real, so the
// no-inheritance rule is proven by executing it, not by reading its source.
const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260807010000_0079_handle_claim_no_inheritance.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const CLAIMANT_USER = "10101010-1010-4101-8101-101010101010";
const HANDLE = "earlybird";
const PRE_CLAIM_ROW = "20202020-2020-4202-8202-202020202020";
const POST_CLAIM_ROW = "30303030-3030-4303-8303-303030303030";
// Fixed far-past timestamp: always earlier than the real wall-clock claimed_at
// the claim RPC stamps at run time, regardless of when this test executes.
const PRE_CLAIM_SUBMITTED_AT = "2020-01-01T00:00:00Z";

function insertContribution(id: string, submittedAt: string, actor: string): string {
  return `
    insert into public.community_prices
      (id, venue_id, drink_category, price_pennies, actor, contributor_handle, submitted_at)
    values
      ('${id}', 'test-venue-handle-claim', 'beer', 450, '${actor}', '${HANDLE}', '${submittedAt}');
  `;
}

let database: PostgresSession | null = null;

beforeAll(async () => {
  if (!existsSync(FORWARD)) throw new Error(`Missing migration: ${FORWARD}`);
  database = await startPostgres({ label: "handle-claim-0079" });
  database.applyFile(SESSION_FIXTURE);
  for (const migration of PREREQUISITES) database.applyFile(migration);
  database.sql(`insert into auth.users(id) values ('${CLAIMANT_USER}');`);
  database.applyFile(FORWARD);
}, 180_000);

afterAll(async () => database?.stop());

describe.skipIf(skipReason !== null)("handle claim no-inheritance migration", () => {
  it("runs the actual prerequisite migration history on PostgreSQL 16", () => {
    const db = database!;
    expect(db.sql("select current_setting('server_version_num')::int / 10000")).toBe("16");
    expect(existsSync(FORWARD)).toBe(true);
  });

  it("excludes a pre-claim contribution, includes a post-claim one, and never rewrites the pre-claim row's own display", () => {
    const db = database!;

    // (1) Seed a contribution recorded under HANDLE before anyone claims it.
    db.sql(insertContribution(PRE_CLAIM_ROW, PRE_CLAIM_SUBMITTED_AT, "pre-claim-device"));

    // (2) Claim HANDLE for real through the production RPC. It creates the
    // profile and the profile_handle_aliases row in one call, and claimed_at
    // defaults to now() - strictly after the fixed 2020 pre-claim timestamp.
    const claimResult = JSON.parse(db.sql(
      `select public.claim_pubmaxx_handle('${CLAIMANT_USER}', '${HANDLE}')`,
    )) as { ok: boolean; profile_id: string; handle: string };
    expect(claimResult.ok).toBe(true);
    expect(claimResult.handle).toBe(HANDLE);

    const claimedAt = db.sql(
      `select claimed_at from public.profile_handle_aliases where lower(handle) = '${HANDLE}'`,
    );
    expect(new Date(claimedAt).getTime()).toBeGreaterThan(new Date(PRE_CLAIM_SUBMITTED_AT).getTime());

    // (3) The pre-claim row must not count toward the claiming profile yet.
    const preClaimLeaderboard = db.sql(
      `select coalesce(total, 0) from public.public_contributor_leaderboard() where handle = '${HANDLE}'`,
    );
    expect(preClaimLeaderboard).toBe("");

    // (4) A contribution recorded after the claim must count.
    db.sql(insertContribution(POST_CLAIM_ROW, claimedAt, "post-claim-device"));
    const postClaimRow = db.sql(
      `select prices, total from public.public_contributor_leaderboard() where handle = '${HANDLE}'`,
    );
    expect(postClaimRow).toBe("1|1");

    // (5) Display-vs-attribution split: the pre-claim row's own surface read
    // still shows the handle it was originally recorded under, unchanged.
    const preClaimDisplay = db.sql(
      `select contributor_handle from public.community_prices where id = '${PRE_CLAIM_ROW}'`,
    );
    expect(preClaimDisplay).toBe(HANDLE);
  });
});
