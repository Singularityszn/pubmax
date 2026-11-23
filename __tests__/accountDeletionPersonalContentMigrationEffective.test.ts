// Migration 0264, proved against a real PostgreSQL 16 holding every migration
// before it.
//
// K17: an account's deletion tombstones the profile row and never deletes it,
// so no cascade from `profiles` ever fires. The trigger (last restated by 0198)
// did not touch Social posts, comments, quotes, saved lists, check-ins or the
// Pubs to try list, and it left the display name and the bio on the tombstone.
// Other people kept reading the deleted person's posts under their handle.
//
//   BEFORE 0264: an account writes in every lane and leaves. Every row stays.
//   AFTER  0264: a second account does the same. Its posts, comments and quotes
//                read as removed, its saved pubs, check-ins and Pubs to try are
//                gone, its name and bio are cleared, and its prices stay with
//                the handle taken off. A live account is untouched.
//   ROLLBACK:    0198's deletion behaviour returns, a third account
//                leaves the pre-0264 way, and the forward file re-applies.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261122180000_0264_account_deletion_personal_content.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261122180000_0264_account_deletion_personal_content_rollback.sql",
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
  photoPost: string;
  photoMedia: string;
  mixedPost: string;
  mixedMedia: string;
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
    photoPost: id(6),
    photoMedia: id(7),
    mixedPost: id(8),
    mixedMedia: id(9),
    comment: id(3),
    quote: id(4),
    drop: id(5),
  };
}

const STAYER = person(9, "stayer259");
/** Leaves before 0264, after 0264, and under the rollback. */
const EARLY = person(1, "early259");
const LEAVER = person(2, "leaver259");
const LATE = person(3, "late259");
const REAPPLIED = person(4, "reapplied259");
const FOLLOWER = "00590000-0000-4000-8000-000000000001";

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("the 0264 proof cluster is not running");
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
    insert into public.social_post_media
      (id, generation, owner_profile_id, object_key, sha256, width, height, byte_size, moderation_state)
      select media_id, media_id, '${p.profileId}', 'social/' || media_id || '/' || media_id || '/image.jpg', '${HASH}', 10, 10, 100, 'approved'
      from (values ('${p.photoMedia}'::uuid), ('${p.mixedMedia}'::uuid)) media(media_id);
    insert into public.social_posts
      (id, author_profile_id, author_handle, kind, visibility, body, comment_policy, moderation_state, moderated_at, photo_media_id, photo_alt_text)
      values
        ('${p.photoPost}', '${p.profileId}', '${p.handle}', 'standard', 'public', '', 'open', 'approved', now(), '${p.photoMedia}', 'Photo only'),
        ('${p.mixedPost}', '${p.profileId}', '${p.handle}', 'standard', 'public', 'Photo by ${p.handle}', 'open', 'approved', now(), '${p.mixedMedia}', 'Photo with text');
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
    photoPost: value(`select status from public.social_posts where id = '${p.photoPost}'`),
    mixedPost: value(`select status from public.social_posts where id = '${p.mixedPost}'`),
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
  photoPost: "visible",
  mixedPost: "visible",
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
  photoPost: "removed",
  mixedPost: "removed",
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

async function holdJob(kind: string, contentId: string) {
  const owner = spawn(db().psql, [...db().databaseArgs, "-X", "-qAt"], { stdio: "pipe" });
  let output = "";
  let errors = "";
  owner.stderr.on("data", (chunk) => { errors += String(chunk); });
  const finished = new Promise<void>((resolve, reject) => {
    owner.once("error", reject);
    owner.once("close", (code) => code === 0 ? resolve() : reject(new Error(errors)));
  });
  void finished.catch(() => {});
  const ready = new Promise<void>((resolve) => {
    owner.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.split(/\r?\n/).includes("JOB_LOCKED")) resolve();
    });
  });
  owner.stdin.write(`begin;
    select content_id from public.social_interaction_moderation_jobs
      where content_kind = '${kind}' and content_id = '${contentId}' for update;
    \\echo JOB_LOCKED
  `);
  try {
    await Promise.race([ready, finished.then(() => { throw new Error("Job owner exited before locking"); })]);
  } catch (error) {
    owner.stdin.end("rollback;\n");
    await finished.catch(() => {});
    throw error;
  }
  return async (statement = "") => {
    owner.stdin.end(`${statement}\ncommit;\n`);
    await finished;
  };
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "personal-content-0264", database: "pubmax_personal_content_0264" });
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

describe.skipIf(skipReason !== null)("0264: an account's deletion removes its personal content", () => {
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
    expect(value(`select bool_and(photo_media_id is null and photo_alt_text is null and body <> '')::text
      from public.social_posts where author_profile_id = '${LEAVER.profileId}'`))
      .toBe("true");
    expect(value(`select body from public.social_posts where id = '${LEAVER.post}'`)).toBe(`Post by ${LEAVER.handle}`);
    expect(value(`select body from public.social_posts where id = '${LEAVER.mixedPost}'`)).toBe(`Photo by ${LEAVER.handle}`);
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

  it.each(["comment", "quote"] as const)("AFTER: deletion waits for the %s job before locking content", async (kind) => {
    const leaver = person(kind === "comment" ? 0 : 8, `lock259${kind}`);
    const table = kind === "comment" ? "social_comments" : "social_quotes";
    seed(leaver);
    value(`update public.${table} set moderation_state = 'pending' where id = '${leaver[kind]}'`);
    value(`insert into public.social_interaction_moderation_jobs
      (content_kind, content_id, moderation_claim, state, lease_token, lease_until)
      values ('${kind}', '${leaver[kind]}', 'Concurrent moderation', 'leased', '${leaver.userId}', now() + interval '2 minutes')`);
    const finish = await holdJob(kind, leaver[kind]);
    const deletion = db().sqlAsync(`set application_name = 'deletion_0264'; delete from auth.users where id = '${leaver.userId}'`);
    void deletion.catch(() => {});
    try {
      await expect.poll(() => db().sqlAsync(`select exists(select 1 from pg_stat_activity
        where application_name = 'deletion_0264' and wait_event_type = 'Lock'
          and cardinality(pg_blocking_pids(pid)) > 0)`)).toBe("t");
      for (const sibling of ["comment", "quote"] as const) {
        const siblingTable = sibling === "comment" ? "social_comments" : "social_quotes";
        expect(value(`select id from public.${siblingTable} where id = '${leaver[sibling]}' for update nowait`)).toBe(leaver[sibling]);
      }
    } finally {
      await finish(`do $$ begin
        if not public.complete_social_interaction_moderation_job('${kind}', '${leaver[kind]}', '${leaver.userId}'::uuid, 'approved', null, null)
          then raise exception 'completion failed'; end if;
      end $$;`);
      await deletion;
    }
    expect(footprint(leaver)).toEqual(REMOVED);
    expect(value(`select count(*) from public.social_interaction_moderation_jobs where content_id = '${leaver[kind]}'`)).toBe("0");
    stayerUntouched();
  });

  it.each(["comment", "quote"] as const)("AFTER: every completion entry point locks the %s job first", async (kind) => {
    const table = kind === "comment" ? "social_comments" : "social_quotes";
    const contentId = STAYER[kind];
    value(`delete from public.social_interaction_moderation_jobs where content_kind = '${kind}' and content_id = '${contentId}'`);
    for (const mode of ["direct", "tokenless", "token"]) {
      value(`update public.${table} set moderation_state = 'pending' where id = '${contentId}'`);
      value(`insert into public.social_interaction_moderation_jobs
        (content_kind, content_id, moderation_claim, state, lease_token, lease_until)
        values ('${kind}', '${contentId}', 'Live moderation', 'leased',
          ${mode === "token" ? `'${STAYER.userId}'::uuid` : "null"}, now() + interval '2 minutes')`);
      const finish = await holdJob(kind, contentId);
      const call = mode === "direct"
        ? `public.complete_social_interaction_moderation('${kind}', '${contentId}', 'approved')`
        : `public.complete_social_interaction_moderation_job('${kind}', '${contentId}',
            ${mode === "token" ? `'${STAYER.userId}'::uuid,` : ""} 'approved', null, null)`;
      const completion = db().sqlAsync(`set application_name = 'completion_0264'; select ${call}`);
      void completion.catch(() => {});
      try {
        await expect.poll(() => db().sqlAsync(`select exists(select 1 from pg_stat_activity
          where application_name = 'completion_0264' and wait_event_type = 'Lock'
            and cardinality(pg_blocking_pids(pid)) > 0)`)).toBe("t");
        expect(value(`select id from public.${table} where id = '${contentId}' for update nowait`)).toBe(contentId);
      } finally {
        await finish();
        await completion;
      }
      expect(await completion).toBe("t");
      expect(value(`select moderation_state || ':' || status from public.${table} where id = '${contentId}'`)).toBe("approved:visible");
      expect(value(`select count(*) from public.social_interaction_moderation_jobs where content_id = '${contentId}'`)).toBe("0");
    }
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
    // What 0264 already removed stays removed.
    expect(footprint(LEAVER)).toEqual(REMOVED);

    db().applyFile(FORWARD);
    seed(REAPPLIED);
    await leave(REAPPLIED);
    expect(footprint(REAPPLIED)).toEqual(REMOVED);
    stayerUntouched();
  });
});
