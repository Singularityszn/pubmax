// Migration 0174, proved against a real PostgreSQL replay of every migration:
// the CHECKs that hold a diary row to its bounds, the one-entry-per-pub-per-day
// key, the owner-only read for a signed-in browser, the refusal of every
// browser write and of anon, the cascade when an account leaves, and a
// rollback that applies cleanly and lets the forward file apply again.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const FORWARD = join(MIGRATIONS, "20261006120000_0174_diary_entries.sql");
const ROLLBACK = join(MIGRATIONS, "rollback/20261006120000_0174_diary_entries_rollback.sql");

const ALICE_USER = "a1111111-1111-4111-8111-111111111111";
const ALICE = "a2222222-2222-4222-8222-222222222222";
const BOB_USER = "b1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";
const VENUE = "venue-1f5ygjb";

let session: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "diary-0174", database: "pubmax_diary_0174" });
  session.sql(`
    insert into auth.users (id) values ('${ALICE_USER}'), ('${BOB_USER}');
    insert into public.profiles (id, user_id, handle) values
      ('${ALICE}', '${ALICE_USER}', 'alicepm'),
      ('${BOB}', '${BOB_USER}', 'bobpm');
  `);
}, 300_000);

afterAll(async () => {
  await session?.stop();
});

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL diary session did not start.");
  return session;
}

function insert(
  owner: string,
  visitedOn: string,
  fields: { venue?: string; rating?: string; review?: string; visibility?: string } = {},
): string {
  return `
    insert into public.diary_entries (owner_profile_id, venue_id, venue_name, visited_on, rating, review, visibility)
    values ('${owner}', '${fields.venue ?? VENUE}', 'The Blackfriar', '${visitedOn}',
      ${fields.rating ?? "null"}, '${fields.review ?? ""}', '${fields.visibility ?? "private"}')`;
}

describe.skipIf(skipReason !== null)("0174 diary entries", () => {
  it("takes a rated visit and an unrated one from the service role", async () => {
    const rated = await db().attempt(asServiceRole(insert(ALICE, "2026-10-04", { rating: "4.5", review: "Calm back room." })));
    expect(rated.ok, rated.said).toBe(true);
    const unrated = await db().attempt(asServiceRole(insert(ALICE, "2026-10-05")));
    expect(unrated.ok, unrated.said).toBe(true);
  });

  it("holds a rating to half stars from 1 to 5", async () => {
    for (const rating of ["0", "0.5", "5.5", "4.2", "9.9"]) {
      const answer = await db().attempt(asServiceRole(insert(ALICE, "2026-09-01", { rating })));
      expect(answer.ok, `rating ${rating}`).toBe(false);
      expect(answer.said).toMatch(/diary_entries_rating_check|out of range/);
    }
    for (const [i, rating] of ["1", "1.5", "5"].entries()) {
      const answer = await db().attempt(asServiceRole(insert(ALICE, `2026-08-0${i + 1}`, { rating })));
      expect(answer.ok, answer.said).toBe(true);
    }
  });

  it("refuses a review over 280 characters, a day before 2000, and any visibility but private", async () => {
    const long = await db().attempt(asServiceRole(insert(ALICE, "2026-07-01", { review: "x".repeat(281) })));
    expect(long.ok).toBe(false);
    expect(long.said).toMatch(/diary_entries_review_len_check/);
    const early = await db().attempt(asServiceRole(insert(ALICE, "1999-12-31")));
    expect(early.ok).toBe(false);
    expect(early.said).toMatch(/diary_entries_visited_on_check/);
    for (const visibility of ["friends", "public"]) {
      const answer = await db().attempt(asServiceRole(insert(ALICE, "2026-07-02", { visibility })));
      expect(answer.ok).toBe(false);
      expect(answer.said).toMatch(/diary_entries_visibility_check/);
    }
  });

  it("allows one entry per owner, pub and day, and no second", async () => {
    const again = await db().attempt(asServiceRole(insert(ALICE, "2026-10-04", { rating: "2" })));
    expect(again.ok).toBe(false);
    expect(again.said).toMatch(/diary_entries_one_per_venue_day/);
    const otherPub = await db().attempt(asServiceRole(insert(ALICE, "2026-10-04", { venue: "venue-other" })));
    expect(otherPub.ok, otherPub.said).toBe(true);
    const otherOwner = await db().attempt(asServiceRole(insert(BOB, "2026-10-04", { review: "Bob night." })));
    expect(otherOwner.ok, otherOwner.said).toBe(true);
  });

  it("lets a signed-in browser read its own rows only", async () => {
    const own = db().sql(
      asBrowserRole("authenticated", ALICE_USER, "select count(*) from public.diary_entries"),
    );
    const ownRows = Number(own.split("\n").pop());
    const total = Number(db().sql("select count(*) from public.diary_entries"));
    expect(ownRows).toBeGreaterThan(0);
    expect(ownRows).toBeLessThan(total);
    const bob = db().sql(
      asBrowserRole("authenticated", BOB_USER, "select review from public.diary_entries"),
    );
    expect(bob.split("\n").pop()).toBe("Bob night.");
    const stranger = db().sql(
      asBrowserRole("authenticated", "c1111111-1111-4111-8111-111111111111", "select count(*) from public.diary_entries"),
    );
    expect(stranger.split("\n").pop()).toBe("0");
  });

  it("refuses every browser write, to the owner and to a stranger alike", async () => {
    for (const sub of [ALICE_USER, BOB_USER]) {
      const write = await db().attempt(asBrowserRole("authenticated", sub, insert(ALICE, "2026-06-01")));
      expect(write.ok).toBe(false);
      expect(write.said).toMatch(/42501|permission denied/);
      const update = await db().attempt(
        asBrowserRole("authenticated", sub, "update public.diary_entries set review = 'tampered'"),
      );
      expect(update.ok).toBe(false);
      expect(update.said).toMatch(/42501|permission denied/);
      const remove = await db().attempt(asBrowserRole("authenticated", sub, "delete from public.diary_entries"));
      expect(remove.ok).toBe(false);
      expect(remove.said).toMatch(/42501|permission denied/);
    }
    expect(db().sql("select count(*) from public.diary_entries where review = 'tampered'")).toBe("0");
  });

  it("gives anon nothing: no read and no write", async () => {
    const read = await db().attempt(asBrowserRole("anon", null, "select count(*) from public.diary_entries"));
    expect(read.ok).toBe(false);
    expect(read.said).toMatch(/42501|permission denied/);
    const write = await db().attempt(asBrowserRole("anon", null, insert(ALICE, "2026-06-02")));
    expect(write.ok).toBe(false);
    expect(write.said).toMatch(/42501|permission denied/);
  });

  it("leaves with the account: deleting the profile removes its diary and nobody else's", () => {
    const before = Number(db().sql(`select count(*) from public.diary_entries where owner_profile_id = '${BOB}'`));
    expect(before).toBe(1);
    db().sql(`delete from public.profiles where id = '${BOB}'`);
    expect(db().sql(`select count(*) from public.diary_entries where owner_profile_id = '${BOB}'`)).toBe("0");
    expect(Number(db().sql(`select count(*) from public.diary_entries where owner_profile_id = '${ALICE}'`))).toBeGreaterThan(0);
  });

  it("ROLLBACK drops the table, and the forward file applies again", () => {
    db().applyFile(ROLLBACK);
    expect(db().sql("select to_regclass('public.diary_entries') is null")).toBe("t");
    db().applyFile(ROLLBACK);
    db().applyFile(FORWARD);
    expect(db().sql("select count(*) from public.diary_entries")).toBe("0");
    db().applyFile(FORWARD);
  });
});
