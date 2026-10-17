// Migration 0181, proved against a real PostgreSQL 16 holding every migration
// before it.
//
// A mute is one-way and private: the muter's three Social lanes drop the muted
// account's posts, and nothing else moves. The muted account's own lanes, a
// direct read of one post, the follow graph and a third account's lanes are
// all untouched, and the relationship read answers only what the ACTOR set, so
// it can never tell a blocked account who blocked it.
//
//   BEFORE 0181: no table, and the muter's lanes carry the other's posts.
//   AFTER  0181: a mute empties exactly the muter's lanes of that author, an
//                unmute puts them back, a self-mute is refused and no browser
//                role can read the table or call either function.
//   ROLLBACK:    0074's feed comes back byte for byte, the table and the two
//                functions go, and the forward file re-applies.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261017120000_0181_social_mutes.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(MIGRATIONS, "rollback/20261017120000_0181_social_mutes_rollback.sql");
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const MUTER = "a1810000-0000-4000-8000-000000000001";
const MUTED = "a1810000-0000-4000-8000-000000000002";
const BYSTANDER = "a1810000-0000-4000-8000-000000000003";
const MUTED_PUBLIC = "b1810000-0000-4000-8000-000000000001";
const FEED_SIGNATURE = "public.read_social_post_feed(uuid,text,text,timestamptz,uuid,integer)";

let database: PostgresSession | null = null;
let feedBefore = "";

function db(): PostgresSession {
  if (!database) throw new Error("the 0181 proof cluster is not running");
  return database;
}

function value(statement: string): string {
  return db().sql(statement);
}

function service(statement: string): string {
  return value(asServiceRole(statement));
}

/** One lane as the app reads it: the bodies, newest first, joined by `|`. */
function lane(viewer: string, name: "following" | "discover" | "nearby"): string {
  const area = name === "nearby" ? "'camden'" : "null";
  return service(`select coalesce(string_agg(body, '|' order by created_at desc, id desc), '')
    from public.read_social_post_feed('${viewer}', '${name}', ${area}, null, null, 20)`);
}

function relationship(actor: string, target: string): string {
  return service(`select format('%s|%s', blocked, muted) from public.read_social_relationship('${actor}', '${target}')`);
}

function feedDefinition(): string {
  return value(`select pg_get_functiondef('${FEED_SIGNATURE}'::regprocedure)`);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "social-mutes-0181", database: "pubmax_social_mutes_0181" });
  database.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) database.applyFile(path);
  database.sql(`
    insert into public.profiles (id, handle) values
      ('${MUTER}', 'mutemuter'), ('${MUTED}', 'mutemuted'), ('${BYSTANDER}', 'mutebystander');
    -- Muter and muted are mutuals, so the friends post is in the muter's
    -- Following lane before the mute; the bystander follows one way only.
    insert into public.follows (follower_id, followee_id) values
      ('${MUTER}', '${MUTED}'), ('${MUTED}', '${MUTER}'), ('${BYSTANDER}', '${MUTED}');
    insert into public.social_posts
      (id, author_profile_id, author_handle, kind, visibility, body, area_slug, comment_policy, moderation_state, created_at)
    values
      ('${MUTED_PUBLIC}', '${MUTED}', 'mutemuted', 'standard', 'public', 'muted public', 'camden', 'open', 'approved', now() - interval '3 hours'),
      (gen_random_uuid(), '${MUTED}', 'mutemuted', 'standard', 'friends', 'muted friends', 'camden', 'open', 'approved', now() - interval '2 hours'),
      (gen_random_uuid(), '${MUTER}', 'mutemuter', 'standard', 'public', 'muter public', 'camden', 'open', 'approved', now() - interval '1 hour');
  `);
  feedBefore = feedDefinition();
}, 180_000);

afterAll(async () => database?.stop());

describe.skipIf(skipReason !== null)("migration 0181: Social mutes", () => {
  it("BEFORE: there is no mute, and the muter's lanes carry the other account's posts", () => {
    expect(value("select to_regclass('public.social_mutes') is null")).toBe("t");
    expect(lane(MUTER, "following")).toBe("muted friends|muted public");
    expect(lane(MUTER, "discover")).toBe("muter public|muted public");
    expect(lane(MUTER, "nearby")).toBe("muter public|muted public");
  });

  it("AFTER: a mute empties exactly the muter's lanes of that author", () => {
    db().applyFile(FORWARD);
    expect(service(`select public.set_social_mute('${MUTER}', '${MUTED}', true)`)).toBe("t");
    // Desired state: a second mute is the same mute.
    expect(service(`select public.set_social_mute('${MUTER}', '${MUTED}', true)`)).toBe("t");
    expect(value("select count(*) from public.social_mutes")).toBe("1");

    expect(lane(MUTER, "following")).toBe("");
    expect(lane(MUTER, "discover")).toBe("muter public");
    expect(lane(MUTER, "nearby")).toBe("muter public");

    // One-way: the muted account and a third account read as before.
    expect(lane(MUTED, "following")).toBe("muter public");
    expect(lane(BYSTANDER, "following")).toBe("muted public");
    // A direct read is not a lane, and the follow graph does not move.
    expect(service(`select count(*) from public.read_social_post('${MUTED_PUBLIC}', '${MUTER}')`)).toBe("1");
    expect(value(`select count(*) from public.follows where follower_id = '${MUTER}' and followee_id = '${MUTED}'`)).toBe("1");
  });

  it("AFTER: the relationship read answers only what the actor set", () => {
    expect(relationship(MUTER, MUTED)).toBe("false|true");
    expect(relationship(MUTED, MUTER)).toBe("false|false");
    service(`select public.set_social_block('${MUTER}', '${MUTED}', true)`);
    expect(relationship(MUTER, MUTED)).toBe("true|true");
    // The blocked account is never told who blocked it.
    expect(relationship(MUTED, MUTER)).toBe("false|false");
    service(`select public.set_social_block('${MUTER}', '${MUTED}', false)`);
    expect(relationship(MUTER, MUTED)).toBe("false|true");
  });

  it("AFTER: a self-mute is refused and no browser role reaches the table or the functions", () => {
    expect(db().expectRefusal(asServiceRole(`select public.set_social_mute('${MUTER}', '${MUTER}', true)`)))
      .toMatch(/cannot mute self/);
    for (const role of ["anon", "authenticated"] as const) {
      const sub = role === "anon" ? null : MUTER;
      expect(db().expectRefusal(asBrowserRole(role, sub, "select count(*) from public.social_mutes")))
        .toMatch(/permission denied/);
      expect(db().expectRefusal(asBrowserRole(role, sub, `select public.set_social_mute('${MUTER}', '${MUTED}', false)`)))
        .toMatch(/permission denied/);
      expect(db().expectRefusal(asBrowserRole(role, sub, `select * from public.read_social_relationship('${MUTED}', '${MUTER}')`)))
        .toMatch(/permission denied/);
    }
    expect(value("select count(*) from public.social_mutes")).toBe("1");
  });

  it("AFTER: an unmute puts the posts back", () => {
    expect(service(`select public.set_social_mute('${MUTER}', '${MUTED}', false)`)).toBe("t");
    expect(lane(MUTER, "following")).toBe("muted friends|muted public");
    expect(relationship(MUTER, MUTED)).toBe("false|false");
  });

  it("ROLLBACK: 0074's feed comes back byte for byte and the forward file re-applies", () => {
    service(`select public.set_social_mute('${MUTER}', '${MUTED}', true)`);
    db().applyFile(ROLLBACK);
    expect(value("select to_regclass('public.social_mutes') is null")).toBe("t");
    expect(value("select to_regprocedure('public.set_social_mute(uuid,uuid,boolean)') is null")).toBe("t");
    expect(value("select to_regprocedure('public.read_social_relationship(uuid,uuid)') is null")).toBe("t");
    expect(feedDefinition()).toBe(feedBefore);
    expect(lane(MUTER, "following")).toBe("muted friends|muted public");

    db().applyFile(FORWARD);
    expect(value("select count(*) from public.social_mutes")).toBe("0");
    expect(lane(MUTER, "following")).toBe("muted friends|muted public");
  });
});
