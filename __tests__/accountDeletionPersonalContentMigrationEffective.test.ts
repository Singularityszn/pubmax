// Migration 0259, proved against a real PostgreSQL 16 holding every migration
// before it.
//
// K17: an account's deletion tombstones the profile row and never deletes it,
// so no cascade from `profiles` ever fires. The trigger (last restated by 0198)
// did not touch Social posts, comments, quotes, saved lists, check-ins or the
// Pubs to try list, and it left the display name and the bio on the tombstone.
// Other people kept reading the deleted person's posts under their handle.
//
//   BEFORE 0259: an account writes in every lane and leaves. Every row stays.
//   AFTER  0259: a second account does the same. Its posts, comments and quotes
//                read as removed, its saved pubs, check-ins and Pubs to try are
//                gone, its name and bio are cleared, and its prices stay with
//                the handle taken off. A live account is untouched.
//   ROLLBACK:    0198's function comes back byte for byte, a third account
//                leaves the pre-0259 way, and the forward file re-applies.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261122100000_0259_account_deletion_personal_content.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261122100000_0259_account_deletion_personal_content_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const VENUE = "venue-1vle947";
const HASH = "a".repeat(64);

type Person = {
  userId: string;
  profileId: string;
  handle: string;
  post: string;
  comment: string;
  quote: string;
  drop: string;
};

function person(n: number, handle: string): Person {
  const id = (lane: number) => `${n}${lane}590000-0000-4000-8000-0000000000${n}${lane}`;
  return {
    userId: id(0),
    profileId: id(1),
    handle,
    post: id(2),
    comment: id(3),
    quote: id(4),
    drop: id(5),
  };
}

const STAYER = person(9, "stayer259");
/** Leaves before 0259, after 0259, and under the rollback. */
const EARLY = person(1, "early259");
const LEAVER = person(2, "leaver259");
const LATE = person(3, "late259");

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("the 0259 proof cluster is not running");
  return database;
}

function value(statement: string): string {
  return db().sql(statement);
}

/** One account with a row in every lane K17 names, and one price. */
function seed(p: Person): void {
  db().sql(`
    insert into auth.users (id) values ('${p.userId}');
    insert into public.profiles (id, user_id, handle, display_name, bio)
      values ('${p.profileId}', '${p.userId}', '${p.handle}', 'Name of ${p.handle}', 'Bio of ${p.handle}');
    insert into public.social_posts
      (id, author_profile_id, author_handle, kind, visibility, body, comment_policy, moderation_state, moderated_at)
      values ('${p.post}', '${p.profileId}', '${p.handle}', 'standard', 'public', 'Post by ${p.handle}', 'open', 'approved', now());
    insert into public.social_comments
      (id, post_id, author_profile_id, author_handle, body, moderation_state, idempotency_key_hash, payload_digest)
      values ('${p.comment}', '${STAYER.post}', '${p.profileId}', '${p.handle}', 'Comment by ${p.handle}', 'approved', '${HASH}', '${HASH}');
    insert into public.social_quotes
      (id, source_post_id, author_profile_id, author_handle, body, visibility, moderation_state, idempotency_key_hash, payload_digest)
      values ('${p.quote}', '${STAYER.post}', '${p.profileId}', '${p.handle}', 'Quote by ${p.handle}', 'public', 'approved', '${HASH}', '${HASH}');
    insert into public.saved_pubs (profile_id, venue_id, list_type) values ('${p.profileId}', '${VENUE}', 'Cheap Pint');
    insert into public.check_ins (author_id, handle, area_slug, venue_id, note, expires_at)
      values ('${p.profileId}', '${p.handle}', 'camden', '${VENUE}', 'Out with ${p.handle}', now() + interval '2 hours');
    insert into public.wanteds (owner_actor, venue_kind, venue_name, raw_paste)
      values ('profile:${p.profileId}', 'pending', 'The Harp', 'pasted by ${p.handle}');
    insert into public.pint_drops (id, venue_id, handle, drink, price_gbp, provenance, status, created_at)
      values ('${p.drop}', '${VENUE}', '${p.handle}', 'Lager', 4.50, 'contributor', 'visible', now() - interval '1 day');
  `);
}

/** What the database holds about a person, lane by lane. */
function footprint(p: Person) {
  return {
    post: value(`select status from public.social_posts where id = '${p.post}'`),
    comment: value(`select status from public.social_comments where id = '${p.comment}'`),
    quote: value(`select status from public.social_quotes where id = '${p.quote}'`),
    savedPubs: value(`select count(*)::text from public.saved_pubs where profile_id = '${p.profileId}'`),
    checkIns: value(`select count(*)::text from public.check_ins where author_id = '${p.profileId}'`),
    pubsToTry: value(`select count(*)::text from public.wanteds where owner_actor = 'profile:${p.profileId}'`),
    displayName: value(`select coalesce(display_name, '<null>') from public.profiles where id = '${p.profileId}'`),
    bio: value(`select coalesce(bio, '<null>') from public.profiles where id = '${p.profileId}'`),
    price: value(`select price_gbp::text from public.pint_drops where id = '${p.drop}'`),
    priceRetired: value(`select (author_retired_at is not null)::text from public.pint_drops where id = '${p.drop}'`),
  };
}

const KEPT = (p: Person) => ({
  post: "visible",
  comment: "visible",
  quote: "visible",
  savedPubs: "1",
  checkIns: "1",
  pubsToTry: "1",
  displayName: `Name of ${p.handle}`,
  bio: `Bio of ${p.handle}`,
  price: "4.50",
  priceRetired: "true",
});

const REMOVED = {
  post: "removed",
  comment: "removed",
  quote: "removed",
  savedPubs: "0",
  checkIns: "0",
  pubsToTry: "0",
  displayName: "<null>",
  bio: "<null>",
  price: "4.50",
  priceRetired: "true",
};

function stayerUntouched(): void {
  expect(footprint(STAYER)).toEqual({ ...KEPT(STAYER), priceRetired: "false" });
}

async function leave(p: Person): Promise<void> {
  const left = await db().attempt(`delete from auth.users where id = '${p.userId}'`);
  expect(left.ok, left.said).toBe(true);
  expect(value(`select (tombstoned_at is not null)::text from public.profiles where id = '${p.profileId}'`)).toBe("true");
}

const FUNCTION_DEF =
  "select pg_get_functiondef('public.stamp_profile_tombstone_on_auth_user_delete()'::regprocedure)";
let functionBefore = "";

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "personal-content-0259", database: "pubmax_personal_content_0259" });
  database.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) database.applyFile(path);
  seed(STAYER);
  for (const p of [EARLY, LEAVER, LATE]) seed(p);
}, 300_000);

afterAll(async () => {
  await database?.stop();
}, 180_000);

describe.skipIf(skipReason !== null)("0259: an account's deletion removes its personal content", () => {
  it("BEFORE: a deleted account keeps its posts, lists, check-ins, name and bio", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    functionBefore = value(FUNCTION_DEF);
    await leave(EARLY);
    expect(footprint(EARLY)).toEqual(KEPT(EARLY));
    stayerUntouched();
  });

  it("AFTER: the content is removed, the name and bio are cleared, and the price stays", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(FORWARD);
    await leave(LEAVER);
    expect(footprint(LEAVER)).toEqual(REMOVED);
    // A removed post keeps no photo pointer, as the author's own remove does.
    expect(value(`select (photo_media_id is null and photo_alt_text is null)::text from public.social_posts where id = '${LEAVER.post}'`))
      .toBe("true");
    stayerUntouched();
    // Somebody else leaving touches no live account.
    expect(footprint(LATE)).toEqual({ ...KEPT(LATE), priceRetired: "false" });
  });

  it("AFTER: the function keeps security definer and its search_path", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    expect(
      value(
        "select prosecdef::text || ':' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.stamp_profile_tombstone_on_auth_user_delete()'::regprocedure",
      ),
    ).toBe("true:search_path=public");
  });

  it("ROLLBACK restores 0198's function exactly, and the forward file re-applies", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(ROLLBACK);
    expect(value(FUNCTION_DEF)).toBe(functionBefore);

    await leave(LATE);
    expect(footprint(LATE)).toEqual(KEPT(LATE));
    // What 0259 already removed stays removed.
    expect(footprint(LEAVER)).toEqual(REMOVED);

    db().applyFile(FORWARD);
    expect(value(FUNCTION_DEF)).not.toBe(functionBefore);
  });
});
