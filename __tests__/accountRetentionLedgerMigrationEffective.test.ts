// Migration 0150, proved against a real PostgreSQL 16 carrying Supabase's
// storage delete guard.
//
// Captain, 5 September 2026: "We keep the prices, but we remember these
// accounts and what they have logged in." Verification scout verify-preview-4
// (sections 7.3, 10 and 13) measured both halves of what was missing. A
// throwaway account deleted itself through the product; its Pint Drops stayed
// on the map, which is right, and both were still printed under the retired
// handle, one of them leading the Blackfriar sheet on production; and nothing
// anywhere recorded that the account had ever made them.
//
// The guard replica is 0145's, because this file changes the same trigger and a
// cluster without the guard is exactly how D01 stayed green. The proof is:
//
//   BEFORE 0150: an account leaves, its contributions stay, and both faults are
//                reproduced - no ledger table exists, and every contribution
//                still carries the retired handle unmarked.
//   AFTER  0150: a second account leaves; ONE ledger row names it, its handle
//                and the id of every contribution it made in seven lanes; every
//                contribution is still there with its price and its date; the
//                three public lanes are stamped; the contributor board drops
//                the retired name; `anon` and `authenticated` are refused the
//                ledger at the table.
//   ROLLBACK:    the ledger, the stamps and 0079's board come back off, a third
//                account then leaves unrecorded, and the forward file
//                re-applies.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260906090000_0150_account_retention_ledger.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260906090000_0150_account_retention_ledger_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

/** 0145's fixture: Supabase refuses a SQL delete of a storage object. */
const STORAGE_DELETE_GUARD = `
create or replace function storage.protect_delete()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), '') <> 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using errcode = '42501';
  end if;
  return null;
end;
$$;
drop trigger if exists protect_objects_delete on storage.objects;
create trigger protect_objects_delete
  before delete on storage.objects
  for each statement
  execute function storage.protect_delete();
`;

/** Three drinkers who each leave at a different point in the file's life. */
const EARLY = "a0000000-0000-4000-8000-0000000001e1";
const EARLY_PROFILE = "a1000000-0000-4000-8000-0000000001e1";
const LEAVER = "b0000000-0000-4000-8000-0000000002e2";
const LEAVER_PROFILE = "b1000000-0000-4000-8000-0000000002e2";
const LATE = "c0000000-0000-4000-8000-0000000003e3";
const LATE_PROFILE = "c1000000-0000-4000-8000-0000000003e3";
/** Stays, so every assertion about what LEFT has something to be measured against. */
const STAYER = "d0000000-0000-4000-8000-0000000004e4";
const STAYER_PROFILE = "d1000000-0000-4000-8000-0000000004e4";
/** Never claimed a handle: an auth row and nothing else. */
const NAMELESS = "e0000000-0000-4000-8000-0000000005e5";

const LEAVER_DROP = "10000000-0000-4000-8000-000000000101";
const LEAVER_REPORT = "10000000-0000-4000-8000-000000000102";
const LEAVER_PRICE = "10000000-0000-4000-8000-000000000103";
const LEAVER_RECOMMENDATION = "10000000-0000-4000-8000-000000000104";
const LEAVER_MEMORY = "10000000-0000-4000-8000-000000000105";
const LEAVER_MOMENT = "10000000-0000-4000-8000-000000000106";
const LEAVER_WALL_PHOTO = "10000000-0000-4000-8000-000000000107";
const STAYER_DROP = "20000000-0000-4000-8000-000000000201";
const EARLY_DROP = "30000000-0000-4000-8000-000000000301";
const LATE_DROP = "30000000-0000-4000-8000-000000000302";

const VENUE = "venue-1vle947";

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("the 0150 proof cluster is not running");
  return database;
}

function count(statement: string): number {
  return Number(db().sql(statement));
}

function ledgerTableExists(): boolean {
  return db().sql("select to_regclass('public.account_retention_ledger') is not null") === "t";
}

/** One account plus everything it logged, in every lane the ledger records. */
function seedAccount(
  userId: string,
  profileId: string,
  handle: string,
  ids: {
    drop: string;
    report?: string;
    price?: string;
    recommendation?: string;
    memory?: string;
    moment?: string;
    wallPhoto?: string;
  },
): void {
  const extras: string[] = [];
  if (ids.report) {
    extras.push(`insert into public.structured_visit_reports (id, venue_id, handle, visited_at, busyness, note)
      values ('${ids.report}', '${VENUE}', '${handle}', date '2026-09-01', 'steady', 'Quiet corner by the window.');`);
  }
  if (ids.price) {
    extras.push(`insert into public.community_prices (id, venue_id, drink_category, price_pennies, actor, contributor_handle)
      values ('${ids.price}', '${VENUE}', 'beer', 450, 'profile:${profileId}', '${handle}');`);
  }
  if (ids.recommendation) {
    extras.push(`insert into public.weather_recommendations (id, venue_id, condition, reason, contributor_handle, actor_hash)
      values ('${ids.recommendation}', '${VENUE}', 'raining', 'The back room stays dry and the fire is on.', '${handle}', 'hash-${handle}');`);
  }
  if (ids.memory) {
    extras.push(`insert into public.night_memories (id, owner_id, title)
      values ('${ids.memory}', '${userId}', 'A night out');`);
  }
  if (ids.moment && ids.memory) {
    extras.push(`insert into public.night_moments (id, memory_id, owner_id, kind, caption, media_object_key)
      values ('${ids.moment}', '${ids.memory}', '${userId}', 'photo', 'private photo', 'night-moments/${userId}/${ids.memory}/photo.jpg');`);
  }
  if (ids.wallPhoto) {
    extras.push(`insert into public.venue_photos (id, venue_id, author_actor, author_profile_id, object_key, width, height)
      values ('${ids.wallPhoto}', '${VENUE}', 'profile:${profileId}', '${profileId}', 'venue-photos/${VENUE}/${ids.wallPhoto}.jpg', 900, 1200);`);
  }

  db().sql(`
    insert into auth.users (id) values ('${userId}');
    insert into public.profiles (id, user_id, handle) values ('${profileId}', '${userId}', '${handle}');
    insert into public.profile_handle_aliases (profile_id, handle, claimed_at)
      values ('${profileId}', '${handle}', now() - interval '30 days');
    insert into public.pint_drops (id, venue_id, handle, drink, price_gbp, provenance, status, created_at)
      values ('${ids.drop}', '${VENUE}', '${handle}', 'Lager', 4.50, 'contributor', 'visible', now() - interval '2 days');
    ${extras.join("\n")}
  `);
}

function seed(): void {
  seedAccount(EARLY, EARLY_PROFILE, "earlyleaver", { drop: EARLY_DROP });
  seedAccount(LEAVER, LEAVER_PROFILE, "vp4qa39758", {
    drop: LEAVER_DROP,
    report: LEAVER_REPORT,
    price: LEAVER_PRICE,
    recommendation: LEAVER_RECOMMENDATION,
    memory: LEAVER_MEMORY,
    moment: LEAVER_MOMENT,
    wallPhoto: LEAVER_WALL_PHOTO,
  });
  seedAccount(LATE, LATE_PROFILE, "lateleaver", { drop: LATE_DROP });
  seedAccount(STAYER, STAYER_PROFILE, "tester", {
    drop: STAYER_DROP,
    report: "20000000-0000-4000-8000-000000000202",
    price: "20000000-0000-4000-8000-000000000203",
    recommendation: "20000000-0000-4000-8000-000000000204",
  });
  db().sql(`insert into auth.users (id) values ('${NAMELESS}');`);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "retention-0150", database: "pubmax_retention_0150" });
  database.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) database.applyFile(path);
  database.sql(STORAGE_DELETE_GUARD);
  seed();
}, 240_000);

afterAll(async () => {
  await database?.stop();
}, 180_000);

describe.skipIf(skipReason !== null)("0150: a contribution outlives the account, and the account is remembered", () => {
  it("BEFORE: an account leaves, its price stays, and nothing records who logged it", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    expect(ledgerTableExists()).toBe(false);

    const left = await db().attempt(`delete from auth.users where id = '${EARLY}'`);
    expect(left.ok, left.said).toBe(true);

    // The half that already worked, and must keep working: the drop is still
    // on the pub's sheet with its price and its date.
    expect(count(`select count(*) from public.pint_drops where id = '${EARLY_DROP}'`)).toBe(1);
    expect(db().sql(`select price_gbp from public.pint_drops where id = '${EARLY_DROP}'`)).toBe("4.50");

    // Both faults verify-preview-4 measured, reproduced: the retired handle is
    // still on the row unmarked, and nothing anywhere remembers the account.
    expect(db().sql(`select handle from public.pint_drops where id = '${EARLY_DROP}'`)).toBe("earlyleaver");
    expect(ledgerTableExists()).toBe(false);
  });

  it("AFTER: one ledger row names the account and every id it logged", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(FORWARD);
    expect(ledgerTableExists()).toBe(true);

    const left = await db().attempt(`delete from auth.users where id = '${LEAVER}'`);
    expect(left.ok, left.said).toBe(true);

    expect(count("select count(*) from public.account_retention_ledger")).toBe(1);
    expect(
      db().sql(
        `select retired_handle || ':' || profile_id::text from public.account_retention_ledger where account_user_id = '${LEAVER}'`,
      ),
    ).toBe(`vp4qa39758:${LEAVER_PROFILE}`);
    expect(
      db().sql(
        `select deleted_at is not null from public.account_retention_ledger where account_user_id = '${LEAVER}'`,
      ),
    ).toBe("t");

    const lane = (column: string): string =>
      db().sql(
        `select array_to_string(${column}, ',') from public.account_retention_ledger where account_user_id = '${LEAVER}'`,
      );
    expect(lane("pint_drop_ids")).toBe(LEAVER_DROP);
    expect(lane("visit_report_ids")).toBe(LEAVER_REPORT);
    expect(lane("community_price_ids")).toBe(LEAVER_PRICE);
    expect(lane("weather_recommendation_ids")).toBe(LEAVER_RECOMMENDATION);
    expect(lane("night_memory_ids")).toBe(LEAVER_MEMORY);
    expect(lane("night_moment_ids")).toBe(LEAVER_MOMENT);
    // The wall photo ROW is deleted by the same statement, which is why the
    // ledger is written before anything of the account's is removed.
    expect(lane("venue_photo_ids")).toBe(LEAVER_WALL_PHOTO);
    expect(count(`select count(*) from public.venue_photos where id = '${LEAVER_WALL_PHOTO}'`)).toBe(0);
  });

  it("AFTER: the contributions keep their prices and their dates", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    expect(count(`select count(*) from public.pint_drops where id = '${LEAVER_DROP}'`)).toBe(1);
    expect(db().sql(`select price_gbp from public.pint_drops where id = '${LEAVER_DROP}'`)).toBe("4.50");
    expect(
      db().sql(`select created_at < now() from public.pint_drops where id = '${LEAVER_DROP}'`),
    ).toBe("t");
    expect(count(`select count(*) from public.structured_visit_reports where id = '${LEAVER_REPORT}'`)).toBe(1);
    expect(
      db().sql(`select visited_at::text from public.structured_visit_reports where id = '${LEAVER_REPORT}'`),
    ).toBe("2026-09-01");
    expect(db().sql(`select price_pennies::text from public.community_prices where id = '${LEAVER_PRICE}'`)).toBe("450");
    expect(count(`select count(*) from public.weather_recommendations where id = '${LEAVER_RECOMMENDATION}'`)).toBe(1);
  });

  it("AFTER: the three public lanes are stamped, and a live author's rows are not", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    expect(db().sql(`select author_retired_at is not null from public.pint_drops where id = '${LEAVER_DROP}'`)).toBe("t");
    expect(
      db().sql(
        `select author_retired_at is not null from public.structured_visit_reports where id = '${LEAVER_REPORT}'`,
      ),
    ).toBe("t");
    expect(
      db().sql(
        `select author_retired_at is not null from public.weather_recommendations where id = '${LEAVER_RECOMMENDATION}'`,
      ),
    ).toBe("t");

    // The row keeps its handle: withholding is the PUBLIC projection's job
    // (lib/retiredContributor.ts), and a moderator still has to know whose
    // price it is.
    expect(db().sql(`select handle from public.pint_drops where id = '${LEAVER_DROP}'`)).toBe("vp4qa39758");

    expect(db().sql(`select author_retired_at is null from public.pint_drops where id = '${STAYER_DROP}'`)).toBe("t");
  });

  it("AFTER: an account that claimed no handle is still remembered", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    const left = await db().attempt(`delete from auth.users where id = '${NAMELESS}'`);
    expect(left.ok, left.said).toBe(true);
    expect(
      db().sql(
        `select coalesce(retired_handle, 'none') || ':' || coalesce(array_length(pint_drop_ids, 1), 0)::text from public.account_retention_ledger where account_user_id = '${NAMELESS}'`,
      ),
    ).toBe("none:0");
  });

  it("AFTER: the contributor board drops the retired name and keeps the live one", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    const board = db().sql("select handle from public.public_contributor_leaderboard()");
    expect(board.split("\n").filter(Boolean)).toEqual(["tester"]);
  });

  it("AFTER: anon and authenticated are refused the ledger at the table", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    for (const role of ["anon", "authenticated"]) {
      const read = await db().attempt(
        `set role ${role}; select count(*) from public.account_retention_ledger;`,
      );
      expect(read.ok, `${role} could read the retention ledger`).toBe(false);
      expect(read.said).toMatch(/permission denied/i);
    }
    // The grants are the first refusal; the deny policy is the second, so the
    // table is closed even if a grant is ever handed out by mistake.
    expect(db().sql("select relrowsecurity from pg_class where relname = 'account_retention_ledger'")).toBe("t");
    expect(
      count(
        "select count(*) from pg_policies where tablename = 'account_retention_ledger' and policyname = 'account_retention_ledger_client_deny'",
      ),
    ).toBe(1);
  });

  it("ROLLBACK takes the ledger and the stamps off, and the forward file re-applies", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(ROLLBACK);
    expect(ledgerTableExists()).toBe(false);
    expect(
      count(
        "select count(*) from information_schema.columns where table_name = 'pint_drops' and column_name = 'author_retired_at'",
      ),
    ).toBe(0);

    // Under the rollback an account leaves the pre-0150 way: its price stays,
    // and nothing records that it made one.
    const underRollback = await db().attempt(`delete from auth.users where id = '${LATE}'`);
    expect(underRollback.ok, underRollback.said).toBe(true);
    expect(count("select count(*) from public.pint_drops where handle = 'lateleaver'")).toBe(1);
    expect(ledgerTableExists()).toBe(false);

    db().applyFile(FORWARD);
    expect(ledgerTableExists()).toBe(true);
    // The forward file is not retroactive: it records departures from here on,
    // and the rows an earlier departure left are still exactly where they were.
    expect(count("select count(*) from public.account_retention_ledger")).toBe(0);
    expect(count("select count(*) from public.pint_drops where handle = 'lateleaver'")).toBe(1);
  });
});
