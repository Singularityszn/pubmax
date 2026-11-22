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
//   ROLLBACK:    0198's deletion behaviour returns, a third account
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
const REAPPLIED = person(4, "reapplied259");
const FOLLOWER = "00590000-0000-4000-8000-000000000001";

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
    insert into public.saved_lists (profile_id, name) values ('${p.profileId}', 'Memories of ${p.handle}');
    insert into public.saved_list_follows (follower_profile_id, list_owner_profile_id, list_name)
      values ('${FOLLOWER}', '${p.profileId}', 'Memories of ${p.handle}');
    insert into public.social_content_reports (reporter_profile_id, content_kind, content_id, reason)
      values ('${FOLLOWER}', 'comment', '${p.comment}', 'spam'), ('${FOLLOWER}', 'quote', '${p.quote}', 'spam');
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
    customLists: value(`select count(*)::text from public.saved_lists where profile_id = '${p.profileId}'`),
    listFollowCopies: value(`select count(*)::text from public.saved_list_follows where list_owner_profile_id = '${p.profileId}'`),
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
  customLists: "1",
  listFollowCopies: "1",
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
  customLists: "0",
  listFollowCopies: "0",
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

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "personal-content-0259", database: "pubmax_personal_content_0259" });
  database.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) database.applyFile(path);
  database.sql(`insert into public.profiles (id, handle) values ('${FOLLOWER}', 'follower259')`);
  seed(STAYER);
  database.sql(`insert into public.private_social_staff_roles (profile_id, display_name, role)
    values ('${STAYER.profileId}', 'Moderator', 'moderator')`);
  for (const p of [EARLY, LEAVER, LATE]) seed(p);
}, 300_000);

afterAll(async () => {
  await database?.stop();
}, 180_000);

describe.skipIf(skipReason !== null)("0259: an account's deletion removes its personal content", () => {
  it("BEFORE: a deleted account keeps its posts, lists, check-ins, name and bio", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    await leave(EARLY);
    expect(footprint(EARLY)).toEqual(KEPT(EARLY));
    stayerUntouched();
  });

  it("BEFORE: moderation can restore or hide removed interactions", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    for (const kind of ["comment", "quote"] as const) {
      const table = kind === "comment" ? "social_comments" : "social_quotes";
      value(`update public.${table} set status = 'removed' where id = '${EARLY[kind]}'`);
      expect(value(`select public.moderate_social_interaction('${STAYER.profileId}', '${kind}', '${EARLY[kind]}', 'restore')`)).toBe("t");
      expect(value(`select status from public.${table} where id = '${EARLY[kind]}'`)).toBe("visible");
      value(`update public.${table} set status = 'removed', moderation_state = 'pending' where id = '${EARLY[kind]}'`);
      expect(value(`select public.complete_social_interaction_moderation('${kind}', '${EARLY[kind]}', 'needs_review')`)).toBe("t");
      expect(value(`select status from public.${table} where id = '${EARLY[kind]}'`)).toBe("hidden");
    }
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

  it("AFTER: deletion cancels both moderation job kinds in every queue state", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    value(`insert into public.social_interaction_moderation_jobs (content_kind, content_id, moderation_claim)
      values ('comment', '${STAYER.comment}', 'Live comment'), ('quote', '${STAYER.quote}', 'Live quote')`);

    for (const [index, state] of ["pending", "leased", "error"].entries()) {
      const leaver = person(index + 5, `queue259${index}`);
      seed(leaver);
      for (const kind of ["comment", "quote"] as const) {
        const table = kind === "comment" ? "social_comments" : "social_quotes";
        value(`update public.${table} set moderation_state = 'pending' where id = '${leaver[kind]}'`);
        value(`insert into public.social_interaction_moderation_jobs
          (content_kind, content_id, moderation_claim, state, attempts, lease_until, lease_token)
          values ('${kind}', '${leaver[kind]}', 'Deleted content', '${state}', 2,
            now() - interval '1 second', gen_random_uuid())`);
      }
      await leave(leaver);
      expect(value(`select count(*) from public.social_interaction_moderation_jobs
        where content_id in ('${leaver.comment}', '${leaver.quote}')`)).toBe("0");
      expect(footprint(leaver)).toEqual(REMOVED);
    }

    expect(value(`select count(*) from public.social_interaction_moderation_jobs
      where content_id in ('${STAYER.comment}', '${STAYER.quote}')`)).toBe("2");
    expect(value("select count(*) from public.claim_social_interaction_moderation_leases(20)")).toBe("2");
    stayerUntouched();
  });

  it("AFTER: both moderation lanes preserve removal and still moderate live content", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    for (const kind of ["comment", "quote"] as const) {
      const table = kind === "comment" ? "social_comments" : "social_quotes";
      for (const action of ["hide", "restore"]) {
        const removed = await db().attempt(`select public.moderate_social_interaction('${STAYER.profileId}', '${kind}', '${LEAVER[kind]}', '${action}')`);
        expect(removed.ok).toBe(false);
        expect(value(`select status from public.${table} where id = '${LEAVER[kind]}'`)).toBe("removed");
        expect(value(`select public.moderate_social_interaction('${STAYER.profileId}', '${kind}', '${STAYER[kind]}', '${action}')`)).toBe("t");
        expect(value(`select status from public.${table} where id = '${STAYER[kind]}'`)).toBe(action === "hide" ? "hidden" : "visible");
      }
      for (const decision of ["approved", "needs_review"]) {
        value(`update public.${table} set moderation_state = 'pending' where id in ('${LEAVER[kind]}', '${STAYER[kind]}')`);
        expect(value(`select public.complete_social_interaction_moderation('${kind}', '${LEAVER[kind]}', '${decision}')`)).toBe("f");
        expect(value(`select status from public.${table} where id = '${LEAVER[kind]}'`)).toBe("removed");
        expect(value(`select public.complete_social_interaction_moderation('${kind}', '${STAYER[kind]}', '${decision}')`)).toBe("t");
        expect(value(`select status from public.${table} where id = '${STAYER[kind]}'`)).toBe(decision === "needs_review" ? "hidden" : "visible");
      }
      value(`update public.${table} set status = 'visible' where id = '${STAYER[kind]}'`);
    }
    stayerUntouched();
  });

  it("ROLLBACK restores retained content, and reapplication removes a fresh account's content", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(ROLLBACK);

    await leave(LATE);
    expect(footprint(LATE)).toEqual(KEPT(LATE));
    // What 0259 already removed stays removed.
    expect(footprint(LEAVER)).toEqual(REMOVED);

    db().applyFile(FORWARD);
    seed(REAPPLIED);
    await leave(REAPPLIED);
    expect(footprint(REAPPLIED)).toEqual(REMOVED);
    stayerUntouched();
  });
});
