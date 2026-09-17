// Migration 0145, proved against a real PostgreSQL 16 carrying Supabase's
// storage delete guard.
//
// Contribution battle test D01 (5 September 2026): every account deletion
// answered 503, because the tombstone trigger deleted from `storage.objects`
// and Supabase's statement-level `protect_objects_delete` trigger refuses that
// with SQLSTATE 42501 whether or not the statement matches a row. Behind it,
// `private_social_accounts.supabase_user_id` was `on delete restrict`, which
// refused every onboarded account a second time.
//
// The fixture cluster used by the other effective proofs has no such guard,
// which is how the hole stayed green. This file installs a replica of the
// guard (the report's rolled-back probe, section 5, as a fixture), seeds an
// account with every kind of owned photo and a Social Crew, and one account
// that never onboarded, then proves:
//
//   BEFORE 0145: `delete from auth.users` raises 42501 for both accounts.
//   AFTER  0145: both deletes succeed; the profile is tombstoned; the wall
//                photo rows go; the message keeps its words and loses its
//                photo columns; Memories and Moments cascade; the Social
//                account is suspended and unbound while its Crew row keeps
//                referencing it; and NO `storage.objects` row is touched by
//                SQL, because the bytes are the Storage API's to remove
//                (`lib/accountDeletion.server.ts`), before the auth row goes.
//   ROLLBACK:    restores the restrict FK and the old trigger, so a delete
//                under the guard refuses again; the forward file re-applies.
//
// The last block carries 0151 on the same cluster, because review finding F-4
// is about this trigger and not a second one: it applies every migration after
// 0145, seeds an account that RENAMED, and proves the fault before the file and
// its absence after.

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
const FORWARD_NAME = "20260905150000_0145_account_removal_storage_api.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260905150000_0145_account_removal_storage_api_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

/** 0151, the file the last block proves, and everything between it and 0145. */
const SENDER_PROFILE_NAME = "20260906100000_0151_message_sender_profile.sql";
const SENDER_PROFILE = join(MIGRATIONS, SENDER_PROFILE_NAME);
const BETWEEN_0145_AND_0151 = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name > FORWARD_NAME && name < SENDER_PROFILE_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

/**
 * Supabase's guard, as the battle test measured it: a statement-level BEFORE
 * DELETE trigger on `storage.objects` that raises 42501 unless the session
 * set `storage.allow_delete_query`. The message is the platform's own.
 */
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

const ALICE = "a0000000-0000-4000-8000-000000000001";
const ALICE_PROFILE = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ALICE_ACCOUNT = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const BOB = "b0000000-0000-4000-8000-000000000002";
const BOB_PROFILE = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
/** Never onboarded: an auth row and nothing else, the `evepent` case. */
const EVE = "e0000000-0000-4000-8000-000000000003";
const CARL = "c0000000-0000-4000-8000-000000000004";
const CARL_PROFILE = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const PLAN = "d0000000-0000-4000-8000-000000000005";
const PLAN_MEMBER = "d1000000-0000-4000-8000-000000000006";
const CREW = "d2000000-0000-4000-8000-000000000007";
const MEMORY = "f0000000-0000-4000-8000-000000000008";
const MOMENT = "f1000000-0000-4000-8000-000000000009";
const WALL_PHOTO = "f2000000-0000-4000-8000-00000000000a";
const CONVERSATION = "f3000000-0000-4000-8000-00000000000b";
/** Two accounts that RENAMED: Dana leaves before 0151, Erin after it. */
const DANA = "d3000000-0000-4000-8000-00000000000e";
const DANA_PROFILE = "d4000000-0000-4000-8000-00000000000f";
const ERIN = "d5000000-0000-4000-8000-000000000010";
const ERIN_PROFILE = "d6000000-0000-4000-8000-000000000011";
const PHOTO_MESSAGE = "f4000000-0000-4000-8000-00000000000c";
const TEXT_MESSAGE = "f5000000-0000-4000-8000-00000000000d";

const AVATAR_OBJECT = `avatars/${ALICE_PROFILE}/e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6/image.jpg`;
const MOMENT_OBJECT = `night-moments/${ALICE}/${MEMORY}/photo.jpg`;
const WALL_OBJECT = `venue-photos/venue-1f5ygjb/${WALL_PHOTO}.jpg`;
const MESSAGE_OBJECT = `messages/${CONVERSATION}/${PHOTO_MESSAGE}.jpg`;
const OBJECTS = [AVATAR_OBJECT, MOMENT_OBJECT, WALL_OBJECT, MESSAGE_OBJECT];

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("the 0145 proof cluster is not running");
  return database;
}

function count(statement: string): number {
  return Number(db().sql(statement));
}

function fkDeleteRule(): string {
  return db().sql(
    "select confdeltype from pg_constraint where conname = 'private_social_accounts_supabase_user_id_fkey'",
  );
}

function triggerTouchesStorage(): string {
  return db().sql(
    "select prosrc like '%storage.objects%' from pg_proc where proname = 'stamp_profile_tombstone_on_auth_user_delete'",
  );
}

function seed(): void {
  db().sql(`
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}'), ('${EVE}');

    insert into public.profiles (id, user_id, handle, favourite_drink) values
      ('${ALICE_PROFILE}', '${ALICE}', 'alicepm', 'stout'),
      ('${BOB_PROFILE}', '${BOB}', 'bobpm', null);

    -- Alice finished Social onboarding and owns a Crew, so her account row is
    -- referenced by a restrict FK the way every Crew owner's is.
    insert into public.private_social_accounts (id, clerk_user_id, supabase_user_id, profile_id, ownership_state)
      values ('${ALICE_ACCOUNT}', 'clerk-alice', '${ALICE}', '${ALICE_PROFILE}', 'active');
    insert into public.plans (id, title, start_time, status, route_revision, owner_user_id)
      values ('${PLAN}', 'Alice night', now() + interval '4 hours', 'ready', 1, '${ALICE}');
    insert into public.plan_crew_members (id, plan_id, name, token_hash, user_id, status, joined_at, updated_at, can_collaborate)
      values ('${PLAN_MEMBER}', '${PLAN}', 'Alice', repeat('a', 64), '${ALICE}', 'in', now(), now(), true);
    insert into public.social_crews (id, plan_id, owner_account_id)
      values ('${CREW}', '${PLAN}', '${ALICE_ACCOUNT}');
    insert into public.social_crew_members (crew_id, social_account_id, plan_member_id, role)
      values ('${CREW}', '${ALICE_ACCOUNT}', '${PLAN_MEMBER}', 'owner');

    -- Every kind of owned photo: a face, a Moment, a wall photo, a message photo.
    update public.profiles
       set avatar_object_key = '${AVATAR_OBJECT}', avatar_generation = 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6', avatar_moderation_state = 'approved'
     where id = '${ALICE_PROFILE}';
    insert into public.night_memories (id, owner_id, title) values ('${MEMORY}', '${ALICE}', 'Alice night');
    insert into public.night_moments (id, memory_id, owner_id, kind, caption, media_object_key)
      values ('${MOMENT}', '${MEMORY}', '${ALICE}', 'photo', 'private photo', '${MOMENT_OBJECT}');
    insert into public.venue_photos (id, venue_id, author_actor, author_profile_id, object_key, width, height)
      values ('${WALL_PHOTO}', 'venue-1f5ygjb', 'profile:${ALICE_PROFILE}', '${ALICE_PROFILE}', '${WALL_OBJECT}', 900, 1200);
    insert into public.conversations (id, handle_a, handle_b, user_id_a, user_id_b)
      values ('${CONVERSATION}', 'alicepm', 'bobpm', '${ALICE}', '${BOB}');
    insert into public.messages (id, conversation_id, sender_handle, body, attachment_kind, attachment_object_key, attachment_width, attachment_height)
      values ('${PHOTO_MESSAGE}', '${CONVERSATION}', 'alicepm', '', 'photo', '${MESSAGE_OBJECT}', 800, 600);
    insert into public.messages (id, conversation_id, sender_handle, body)
      values ('${TEXT_MESSAGE}', '${CONVERSATION}', 'alicepm', 'see you at eight');

    insert into storage.objects (bucket_id, name, owner_id, metadata) values
      ('pint-drops', '${AVATAR_OBJECT}', '${ALICE}', '{"mimetype":"image/jpeg"}'),
      ('pint-drops', '${MOMENT_OBJECT}', '${ALICE}', '{"mimetype":"image/jpeg"}'),
      ('pint-drops', '${WALL_OBJECT}', '${ALICE}', '{"mimetype":"image/jpeg"}'),
      ('pint-drops', '${MESSAGE_OBJECT}', '${ALICE}', '{"mimetype":"image/jpeg"}');
  `);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "account-removal", database: "pubmax_account_removal_0145" });
  database.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) database.applyFile(path);
  database.sql(STORAGE_DELETE_GUARD);
  seed();
}, 240_000);

afterAll(async () => {
  await database?.stop();
}, 180_000);

describe.skipIf(skipReason !== null)("0145: account removal under Supabase's storage delete guard", () => {
  it("BEFORE: the 0102 trigger raises 42501 for an account with photos and for one that never onboarded", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    expect(fkDeleteRule()).toBe("r");
    expect(triggerTouchesStorage()).toBe("t");

    const withPhotos = await db().attempt(`delete from auth.users where id = '${ALICE}'`);
    expect(withPhotos.ok).toBe(false);
    expect(withPhotos.said).toMatch(/42501/);
    expect(withPhotos.said).toMatch(/Direct deletion from storage tables is not allowed/);

    // The statement-level trigger fires whether or not the delete matches a
    // row, so an account with nothing in the bucket fails the same way.
    const neverOnboarded = await db().attempt(`delete from auth.users where id = '${EVE}'`);
    expect(neverOnboarded.ok).toBe(false);
    expect(neverOnboarded.said).toMatch(/42501/);

    // The whole statement rolled back: both accounts and every row survive.
    expect(count(`select count(*) from auth.users where id in ('${ALICE}', '${EVE}')`)).toBe(2);
    expect(count(`select count(*) from public.profiles where id = '${ALICE_PROFILE}' and tombstoned_at is null`)).toBe(1);
    expect(count("select count(*) from storage.objects where bucket_id = 'pint-drops'")).toBe(OBJECTS.length);
  });

  it("AFTER: both accounts leave, rows and columns go, and no storage row is touched by SQL", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(FORWARD);
    expect(fkDeleteRule()).toBe("n");
    expect(triggerTouchesStorage()).toBe("f");

    const withPhotos = await db().attempt(`delete from auth.users where id = '${ALICE}'`);
    expect(withPhotos.ok, withPhotos.said).toBe(true);
    const neverOnboarded = await db().attempt(`delete from auth.users where id = '${EVE}'`);
    expect(neverOnboarded.ok, neverOnboarded.said).toBe(true);

    expect(count(`select count(*) from auth.users where id in ('${ALICE}', '${EVE}')`)).toBe(0);
    expect(count(`select count(*) from auth.users where id = '${BOB}'`)).toBe(1);

    // 0078: tombstoned, the private card fields cleared, the handle reserved.
    expect(db().sql(`select tombstoned_at is not null from public.profiles where id = '${ALICE_PROFILE}'`)).toBe("t");
    expect(db().sql(`select coalesce(favourite_drink, '') || coalesce(avatar_object_key, '') from public.profiles where id = '${ALICE_PROFILE}'`)).toBe("");
    expect(count("select count(*) from public.profiles where handle = 'alicepm'")).toBe(1);

    // Wall photo rows go; Memories and Moments cascade.
    expect(count(`select count(*) from public.venue_photos where author_profile_id = '${ALICE_PROFILE}'`)).toBe(0);
    expect(count(`select count(*) from public.night_memories where owner_id = '${ALICE}'`)).toBe(0);
    expect(count(`select count(*) from public.night_moments where id = '${MOMENT}'`)).toBe(0);

    // The message keeps its words and loses its photo columns; the photo-only
    // message says what happened rather than standing blank.
    expect(db().sql(`select body from public.messages where id = '${TEXT_MESSAGE}'`)).toBe("see you at eight");
    expect(db().sql(`select body from public.messages where id = '${PHOTO_MESSAGE}'`)).toBe("Photo removed.");
    expect(count(`select count(*) from public.messages where conversation_id = '${CONVERSATION}' and attachment_kind is not null`)).toBe(0);
    expect(count(`select count(*) from public.messages where conversation_id = '${CONVERSATION}'`)).toBe(2);

    // The Social account is suspended and unbound, and its Crew row still
    // references it: the restrict FKs in 0075 are what keep it in the table.
    expect(db().sql(`select ownership_state || ':' || coalesce(supabase_user_id::text, 'null') from public.private_social_accounts where id = '${ALICE_ACCOUNT}'`)).toBe("suspended:null");
    expect(count(`select count(*) from public.social_crews where owner_account_id = '${ALICE_ACCOUNT}'`)).toBe(1);

    // NO storage row was deleted by SQL. The bytes are the Storage API's job,
    // done by `deleteOwnAccount` BEFORE this delete ran; a row deleted here
    // would have orphaned them.
    expect(count("select count(*) from storage.objects where bucket_id = 'pint-drops'")).toBe(OBJECTS.length);
  });

  it("a second delete of a gone account matches no row and refuses nothing", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    const again = await db().attempt(`delete from auth.users where id = '${ALICE}'`);
    expect(again.ok, again.said).toBe(true);
    expect(count(`select count(*) from auth.users where id = '${ALICE}'`)).toBe(0);
  });

  it("ROLLBACK restores the restrict FK and the guarded trigger, and the forward file re-applies", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(ROLLBACK);
    expect(fkDeleteRule()).toBe("r");
    expect(triggerTouchesStorage()).toBe("t");

    db().sql(`
      insert into auth.users (id) values ('${CARL}');
      insert into public.profiles (id, user_id, handle) values ('${CARL_PROFILE}', '${CARL}', 'carlpm');
    `);
    const underRollback = await db().attempt(`delete from auth.users where id = '${CARL}'`);
    expect(underRollback.ok).toBe(false);
    expect(underRollback.said).toMatch(/42501/);

    db().applyFile(FORWARD);
    expect(fkDeleteRule()).toBe("n");
    expect(triggerTouchesStorage()).toBe("f");
    const reapplied = await db().attempt(`delete from auth.users where id = '${CARL}'`);
    expect(reapplied.ok, reapplied.said).toBe(true);
    expect(db().sql(`select tombstoned_at is not null from public.profiles where id = '${CARL_PROFILE}'`)).toBe("t");
  });
});

// ── 0151: the identity a rename cannot move ──────────────────────────────────
//
// Review finding F-4. `messages.sender_handle` is text stamped at send time and
// the rename path never rewrites it, so the tombstone trigger's `p.handle =
// m.sender_handle` join reached only the messages an account sent under its
// CURRENT handle. Every photo it sent under an older one kept its
// `attachment_object_key` and stayed fetchable by the other participant after
// the sender was tombstoned.
describe("0151: a renamed account's message photos leave with it", () => {
  /** A profile that renamed: the alias table is what remembers the old handle. */
  function seedRenamed(
    userId: string,
    profileId: string,
    oldHandle: string,
    handle: string,
    conversationId: string,
    oldMessageId: string,
    newMessageId: string,
  ): void {
    db().sql(`
      insert into auth.users (id) values ('${userId}');
      insert into public.profiles (id, user_id, handle) values ('${profileId}', '${userId}', '${handle}');
      insert into public.profile_handle_aliases (profile_id, handle, is_current, retired_at) values
        ('${profileId}', '${oldHandle}', false, now()),
        ('${profileId}', '${handle}', true, null);
      insert into public.conversations (id, handle_a, handle_b, user_id_a, user_id_b)
        values ('${conversationId}', 'bobpm', '${handle}', '${BOB}', '${userId}');
      insert into public.messages (id, conversation_id, sender_handle, body, attachment_kind, attachment_object_key, attachment_width, attachment_height)
        values
          ('${oldMessageId}', '${conversationId}', '${oldHandle}', 'before the rename', 'photo', 'messages/${conversationId}/${oldMessageId}.jpg', 800, 600),
          ('${newMessageId}', '${conversationId}', '${handle}', 'after the rename', 'photo', 'messages/${conversationId}/${newMessageId}.jpg', 800, 600);
    `);
  }

  const DANA_OLD_MESSAGE = "d7000000-0000-4000-8000-000000000012";
  const DANA_NEW_MESSAGE = "d8000000-0000-4000-8000-000000000013";
  const DANA_CONVERSATION = "d9000000-0000-4000-8000-000000000014";
  const ERIN_OLD_MESSAGE = "da000000-0000-4000-8000-000000000015";
  const ERIN_NEW_MESSAGE = "db000000-0000-4000-8000-000000000016";
  const ERIN_CONVERSATION = "dc000000-0000-4000-8000-000000000017";

  /** What `lib/accountDeletion.server.ts` collects: the keys it would remove. */
  function collectedKeys(profileId: string, handle: string): string {
    return db().sql(`
      select coalesce(string_agg(attachment_object_key, ',' order by attachment_object_key), '')
        from public.messages
       where attachment_object_key is not null
         and (sender_profile_id = '${profileId}' or sender_handle = '${handle}')
    `);
  }

  it("BEFORE: an account that renamed leaves its older photo in the bucket and in the row", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    // Everything between 0145 and 0151, so the trigger under test is 0150's.
    for (const path of BETWEEN_0145_AND_0151) db().applyFile(path);
    seedRenamed(DANA, DANA_PROFILE, "danaold", "danapm", DANA_CONVERSATION, DANA_OLD_MESSAGE, DANA_NEW_MESSAGE);

    const gone = await db().attempt(`delete from auth.users where id = '${DANA}'`);
    expect(gone.ok, gone.said).toBe(true);

    // THE FAULT. The message sent under the current handle lost its photo; the
    // one sent under the retired handle still names an object in the bucket.
    expect(db().sql(`select attachment_object_key is null from public.messages where id = '${DANA_NEW_MESSAGE}'`)).toBe("t");
    expect(db().sql(`select attachment_object_key from public.messages where id = '${DANA_OLD_MESSAGE}'`))
      .toBe(`messages/${DANA_CONVERSATION}/${DANA_OLD_MESSAGE}.jpg`);
  });

  it("AFTER: the backfill stamps the rows already sent, and the trigger stamps every new one", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(SENDER_PROFILE);

    // The backfill read the alias table, so Dana's pre-rename row now names its
    // author even though her account has already gone.
    expect(db().sql(`select sender_profile_id from public.messages where id = '${DANA_OLD_MESSAGE}'`)).toBe(DANA_PROFILE);

    // A message sent from here on is stamped by the insert trigger, whichever
    // handle it carries.
    seedRenamed(ERIN, ERIN_PROFILE, "erinold", "erinpm", ERIN_CONVERSATION, ERIN_OLD_MESSAGE, ERIN_NEW_MESSAGE);
    expect(count(`select count(*) from public.messages where sender_profile_id = '${ERIN_PROFILE}'`)).toBe(2);

    // What the deletion COLLECTS: both photos, the pre-rename one included.
    expect(collectedKeys(ERIN_PROFILE, "erinpm")).toBe(
      [
        `messages/${ERIN_CONVERSATION}/${ERIN_NEW_MESSAGE}.jpg`,
        `messages/${ERIN_CONVERSATION}/${ERIN_OLD_MESSAGE}.jpg`,
      ]
        .sort()
        .join(","),
    );
  });

  it("AFTER: both attachment columns are cleared when the renamed account leaves", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    const gone = await db().attempt(`delete from auth.users where id = '${ERIN}'`);
    expect(gone.ok, gone.said).toBe(true);

    expect(count(`select count(*) from public.messages where conversation_id = '${ERIN_CONVERSATION}' and attachment_kind is not null`)).toBe(0);
    expect(count(`select count(*) from public.messages where conversation_id = '${ERIN_CONVERSATION}' and attachment_object_key is not null`)).toBe(0);
    // The words each message carried stay in the thread.
    expect(db().sql(`select body from public.messages where id = '${ERIN_OLD_MESSAGE}'`)).toBe("before the rename");
    expect(db().sql(`select body from public.messages where id = '${ERIN_NEW_MESSAGE}'`)).toBe("after the rename");
    // Nothing here removes bytes: that is the Storage API's job either way.
    expect(count("select count(*) from storage.objects where bucket_id = 'pint-drops'")).toBe(OBJECTS.length);
  });

  it("cannot reach another account's rows through the handle half of the union", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    // Bob is still here and still has his own thread rows. A retired handle is
    // never re-issued (0029's unique index on lower(handle) plus 0078's kept
    // profile row), so the handle match can only ever name its own account.
    expect(count(`select count(*) from public.profiles where id = '${BOB_PROFILE}' and tombstoned_at is null`)).toBe(1);
    expect(count(`select count(*) from public.messages where sender_handle = 'bobpm' and attachment_kind is not null`)).toBe(0);
    expect(count("select count(*) from public.profile_handle_aliases where handle = 'danaold'")).toBe(1);
  });
});
