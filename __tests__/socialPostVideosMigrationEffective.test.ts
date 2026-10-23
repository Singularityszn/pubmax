// Effective PostgreSQL proof for 0183 (Social post videos).
//
// An upload intent belongs to one owner, carries a checked type and size, and
// binds once to that owner's own post. A video reads back to its author at
// once and to anybody else only after a moderator approves it. Browser roles
// hold nothing, and the rollback takes every table and function away.

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

const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20261017140000_0183_social_post_videos_rollback.sql",
);

const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const ALICE_POST = "20000000-0000-4000-8000-000000000001";
const BOB_POST = "20000000-0000-4000-8000-000000000002";

let database: PostgresSession | null = null;
let aliceUpload = "";

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function upload(owner: string, type: string, bytes: number): string {
  return asServiceRole(`select upload_id || '|' || object_key from public.create_social_video_upload('${owner}', '${type}', ${bytes});`);
}

function attach(post: string, owner: string, uploadId: string, bytes: number, duration = "42.5"): string {
  return asServiceRole(`select review_state from public.attach_social_post_video('${post}', '${owner}', '${uploadId}', ${bytes}, ${duration});`);
}

function visible(post: string, viewer: string): string {
  return db().sql(asServiceRole(
    `select coalesce(string_agg(review_state, ','), 'none') from public.read_social_post_videos(array['${post}']::uuid[], '${viewer}');`,
  ));
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startMigratedPostgres({ label: "post-videos", database: "pubmax_post_videos" });
  db().sql(`insert into public.profiles (id, handle) values ('${ALICE}', 'alice'), ('${BOB}', 'bob');`);
  for (const [id, author, handle] of [[ALICE_POST, ALICE, "alice"], [BOB_POST, BOB, "bob"]]) {
    db().sql(
      "insert into public.social_posts (id, author_profile_id, author_handle, kind, visibility, body, comment_policy) " +
        `values ('${id}', '${author}', '${handle}', 'standard', 'friends', 'Reel', 'open');`,
    );
  }
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0183 social post videos", () => {
  it("opens an upload intent with a server-made key for a listed type and size", () => {
    const [id, key] = db().sql(upload(ALICE, "video/mp4", 5_000_000)).split("|");
    aliceUpload = id!;
    expect(key).toBe(`social-video/${id}/video.mp4`);
    expect(db().sql(upload(ALICE, "video/quicktime", 10)).split("|")[1]).toMatch(/video\.mov$/);
  });

  it("refuses an unlisted type, an empty or oversize file, and a sixth open intent", () => {
    expect(db().expectRefusal(upload(ALICE, "video/x-msvideo", 10))).toMatch(/invalid Social video type/);
    expect(db().expectRefusal(upload(ALICE, "video/mp4", 0))).toMatch(/invalid Social video size/);
    expect(db().expectRefusal(upload(ALICE, "video/mp4", 104_857_601))).toMatch(/invalid Social video size/);
    for (let i = 0; i < 3; i += 1) db().sql(upload(ALICE, "video/webm", 10));
    expect(db().expectRefusal(upload(ALICE, "video/webm", 10))).toMatch(/too many open/);
  });

  it("binds an intent once, to its owner's own post, within its declared size", () => {
    expect(db().expectRefusal(attach(BOB_POST, ALICE, aliceUpload, 100))).toMatch(/post not found/);
    expect(db().expectRefusal(attach(ALICE_POST, BOB, aliceUpload, 100))).toMatch(/post not found/);
    expect(db().expectRefusal(attach(ALICE_POST, ALICE, aliceUpload, 5_000_001))).toMatch(/invalid Social video size/);
    expect(db().expectRefusal(attach(ALICE_POST, ALICE, aliceUpload, 100, "601"))).toMatch(/invalid Social video duration/);
    expect(db().sql(attach(ALICE_POST, ALICE, aliceUpload, 4_900_000))).toBe("held");
    // A retried post re-attaches the same upload to the same post and gets the
    // video already there, rather than a refusal it could never get past.
    expect(db().sql(attach(ALICE_POST, ALICE, aliceUpload, 100))).toBe("held");
    expect(db().sql(asServiceRole(`select count(*) from public.social_post_videos where post_id = '${ALICE_POST}';`))).toBe("1");
    // Anybody else naming that upload still gets nothing.
    expect(db().expectRefusal(attach(BOB_POST, BOB, aliceUpload, 100))).toMatch(/upload not found/);
  });

  it("refuses an expired intent", () => {
    const [id] = db().sql(upload(BOB, "video/mp4", 100)).split("|");
    db().sql(`update public.social_video_uploads set expires_at = now() - interval '1 second' where id = '${id}';`);
    expect(db().expectRefusal(attach(BOB_POST, BOB, id!, 50))).toMatch(/upload not found/);
  });

  it("shows a held video to its author only, and to everybody once approved", () => {
    expect(visible(ALICE_POST, ALICE)).toBe("held");
    expect(visible(ALICE_POST, BOB)).toBe("none");
    expect(db().sql(asServiceRole("select count(*) from public.read_held_social_post_videos(50);"))).toBe("1");
    expect(db().sql(asServiceRole(`select public.review_social_post_video('${ALICE_POST}', 'approved');`))).toBe("t");
    expect(visible(ALICE_POST, BOB)).toBe("approved");
    expect(db().sql(asServiceRole("select count(*) from public.read_held_social_post_videos(50);"))).toBe("0");
    db().sql(asServiceRole(`select public.review_social_post_video('${ALICE_POST}', 'rejected');`));
    expect(visible(ALICE_POST, BOB)).toBe("none");
    expect(visible(ALICE_POST, ALICE)).toBe("rejected");
    expect(db().expectRefusal(asServiceRole(`select public.review_social_post_video('${ALICE_POST}', 'maybe');`))).toMatch(/invalid Social video decision/);
  });

  it("gives browser roles nothing on the tables or the functions", () => {
    for (const role of ["anon", "authenticated"] as const) {
      for (const table of ["social_video_uploads", "social_post_videos"]) {
        expect(db().sql(`select has_table_privilege('${role}', 'public.${table}', 'select,insert,update,delete');`)).toBe("f");
      }
      for (const fn of [
        "create_social_video_upload(uuid,text,bigint)",
        "attach_social_post_video(uuid,uuid,uuid,bigint,numeric)",
        "read_social_post_videos(uuid[],uuid)",
        "review_social_post_video(uuid,text)",
        "read_held_social_post_videos(integer)",
      ]) {
        expect(db().sql(`select has_function_privilege('${role}', 'public.${fn}', 'execute');`)).toBe("f");
      }
      expect(db().expectRefusal(asBrowserRole(role, ALICE, "select * from public.social_post_videos;"))).toMatch(/permission denied/);
    }
  });

  it("rolls back to no tables and no functions, and a second rollback is a no-op", () => {
    db().applyFile(ROLLBACK);
    db().applyFile(ROLLBACK);
    expect(db().sql("select to_regclass('public.social_post_videos') is null and to_regclass('public.social_video_uploads') is null;")).toBe("t");
    expect(db().sql("select count(*) from pg_proc where proname like '%social%video%';")).toBe("0");
    expect(db().sql("select count(*) from public.social_posts;")).toBe("2");
  });
});
