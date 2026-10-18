// Migration 0191, proved against a real PostgreSQL 16 holding every migration
// before it.
//
// A hidden-name post is a Social Post whose author chose that readers see "a
// PUBMAXXER". The table keeps the author; the reading rule is the app's. What
// the database owns is that the choice is stamped atomically, that the post is
// public with no pub and no tags, and that the Following lane never carries it.
//
//   BEFORE 0191: no column, no door.
//   AFTER  0191: every existing row reads named; the door stamps the flag and
//                replays to the same row; tags, friends-only and a pub are
//                refused at the door AND by the table; Following drops the post
//                while Discover and Nearby keep it; no browser role can call it.
//   ROLLBACK:    every hidden-name post leaves every read BEFORE the column
//                goes, 0188's feed comes back byte for byte, the rollback
//                re-runs, and the forward file re-applies.

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
const FORWARD_NAME = "20261018120000_0191_social_post_hidden_name.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(MIGRATIONS, "rollback/20261018120000_0191_social_post_hidden_name_rollback.sql");
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const AUTHOR = "a1910000-0000-4000-8000-000000000001";
const READER = "a1910000-0000-4000-8000-000000000002";
const NAMED = "b1910000-0000-4000-8000-000000000001";
const FEED_SIGNATURE = "public.read_social_post_feed(uuid,text,text,timestamptz,uuid,integer)";
const DOOR_SIGNATURE = "public.create_social_post_hidden_name(uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[],text,text)";

let database: PostgresSession | null = null;
let feedBefore = "";

function db(): PostgresSession {
  if (!database) throw new Error("the 0191 proof cluster is not running");
  return database;
}

function value(statement: string): string {
  return db().sql(statement);
}

function service(statement: string): string {
  return value(asServiceRole(statement));
}

/** One call of the door, as the store makes it. */
function door(options: {
  body?: string;
  visibility?: string;
  venue?: string | null;
  tags?: string;
  key: string;
  digest?: string;
}): string {
  const venue = options.venue ? `'${options.venue}'` : "null";
  return `select format('%s|%s|%s', author_name_hidden, visibility, body)
    from public.create_social_post_hidden_name(
      '${AUTHOR}', 'hiddenauthor', 'standard', '${options.visibility ?? "public"}',
      '${options.body ?? "hidden words"}', 'camden', ${venue}, '{}', 'open',
      null, null, null, null, null, null, null, '${options.tags ?? "{}"}',
      '${options.key}', '${options.digest ?? "a".repeat(64)}')`;
}

/** One lane as the app reads it: the bodies, newest first, joined by `|`. */
function lane(name: "following" | "discover" | "nearby"): string {
  const area = name === "nearby" ? "'camden'" : "null";
  return service(`select coalesce(string_agg(body, '|' order by created_at desc, id desc), '')
    from public.read_social_post_feed('${READER}', '${name}', ${area}, null, null, 20)`);
}

function feedDefinition(): string {
  return value(`select pg_get_functiondef('${FEED_SIGNATURE}'::regprocedure)`);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "social-hidden-name-0191", database: "pubmax_social_hidden_name_0191" });
  database.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) database.applyFile(path);
  database.sql(`
    insert into public.profiles (id, handle) values
      ('${AUTHOR}', 'hiddenauthor'), ('${READER}', 'hiddenreader');
    -- The reader follows the author, so a named post is in the reader's
    -- Following lane and a hidden-name one would name the author there.
    insert into public.follows (follower_id, followee_id) values ('${READER}', '${AUTHOR}');
    insert into public.social_posts
      (id, author_profile_id, author_handle, kind, visibility, body, area_slug, comment_policy, moderation_state, created_at)
    values
      ('${NAMED}', '${AUTHOR}', 'hiddenauthor', 'standard', 'public', 'named before', 'camden', 'open', 'approved', now() - interval '2 hours');
  `);
  feedBefore = feedDefinition();
}, 180_000);

afterAll(async () => database?.stop());

describe.skipIf(skipReason !== null)("migration 0191: Social posts with the author's name hidden", () => {
  it("BEFORE: there is no column and no door", () => {
    expect(value(`select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'social_posts' and column_name = 'author_name_hidden'`)).toBe("0");
    expect(value(`select to_regprocedure('${DOOR_SIGNATURE}') is null`)).toBe("t");
  });

  it("AFTER: every existing row reads named", () => {
    db().applyFile(FORWARD);
    expect(value(`select author_name_hidden from public.social_posts where id = '${NAMED}'`)).toBe("f");
  });

  it("AFTER: the door stamps the flag in the insert's own transaction and replays to the same row", () => {
    expect(service(door({ key: "hidden-key-0000000001" }))).toBe("t|public|hidden words");
    expect(service(door({ key: "hidden-key-0000000001" }))).toBe("t|public|hidden words");
    expect(value("select count(*) from public.social_posts where body = 'hidden words'")).toBe("1");
    expect(db().expectRefusal(asServiceRole(door({ key: "hidden-key-0000000001", body: "other", digest: "b".repeat(64) }))))
      .toMatch(/idempotency conflict/);
  });

  it("AFTER: tags, friends-only and a pub are refused at the door", () => {
    expect(db().expectRefusal(asServiceRole(door({ key: "hidden-key-0000000002", tags: "{hiddenreader}" }))))
      .toMatch(/cannot tag people/);
    expect(db().expectRefusal(asServiceRole(door({ key: "hidden-key-0000000003", visibility: "friends" }))))
      .toMatch(/must be public and name no venue/);
    expect(db().expectRefusal(asServiceRole(door({ key: "hidden-key-0000000004", venue: "venue-1" }))))
      .toMatch(/must be public and name no venue/);
    expect(value("select count(*) from public.social_posts")).toBe("2");
  });

  it("AFTER: the table refuses an edit that would make a hidden-name post friends-only or name a pub", () => {
    expect(db().expectRefusal("update public.social_posts set visibility = 'friends' where body = 'hidden words'"))
      .toMatch(/social_posts_hidden_name_shape/);
    expect(db().expectRefusal("update public.social_posts set venue_id = 'venue-1' where body = 'hidden words'"))
      .toMatch(/social_posts_hidden_name_shape/);
  });

  it("AFTER: Following drops the post while Discover and Nearby keep it, flag and all", () => {
    value("update public.social_posts set moderation_state = 'approved' where body = 'hidden words'");
    expect(lane("following")).toBe("named before");
    expect(lane("discover")).toBe("hidden words|named before");
    expect(lane("nearby")).toBe("hidden words|named before");
    expect(service(`select author_name_hidden from public.read_social_post_feed('${READER}', 'discover', null, null, null, 20)
      where body = 'hidden words'`)).toBe("t");
  });

  it("AFTER: no browser role can call the door", () => {
    for (const role of ["anon", "authenticated"] as const) {
      const sub = role === "anon" ? null : AUTHOR;
      expect(db().expectRefusal(asBrowserRole(role, sub, door({ key: `hidden-key-browser-${role}` }))))
        .toMatch(/permission denied/);
    }
    expect(value("select count(*) from public.social_posts")).toBe("2");
  });

  it("ROLLBACK: hidden-name posts leave every read before the column goes, and 0188's feed comes back", () => {
    db().applyFile(ROLLBACK);
    expect(value("select string_agg(format('%s:%s', body, status), ',' order by created_at) from public.social_posts"))
      .toBe("named before:visible,hidden words:hidden");
    expect(value(`select to_regprocedure('${DOOR_SIGNATURE}') is null`)).toBe("t");
    expect(value(`select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'social_posts' and column_name = 'author_name_hidden'`)).toBe("0");
    expect(feedDefinition()).toBe(feedBefore);
    expect(lane("discover")).toBe("named before");

    db().applyFile(ROLLBACK);
    db().applyFile(FORWARD);
    expect(value("select string_agg(format('%s:%s', author_name_hidden, status), ',' order by created_at) from public.social_posts"))
      .toBe("f:visible,f:hidden");
  });
});
