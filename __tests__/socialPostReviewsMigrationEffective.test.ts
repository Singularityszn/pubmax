// Effective PostgreSQL proof for 0181 (Social post reviews).
//
// A score attaches only to a post its author owns that names a venue, on the
// half-step scale from 1 to 5. The ranking reads one row per venue, the newest
// score, best first, and follows the post's venue rather than a copy of it.
// Browser roles hold nothing, and the rollback takes the table and both
// functions away.

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
  "supabase/migrations/rollback/20261017120000_0181_social_post_reviews_rollback.sql",
);

const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const POST_BEEHIVE = "10000000-0000-4000-8000-000000000001";
const POST_BEEHIVE_AGAIN = "10000000-0000-4000-8000-000000000002";
const POST_SOL = "10000000-0000-4000-8000-000000000003";
const POST_NO_VENUE = "10000000-0000-4000-8000-000000000004";
const POST_BOB = "10000000-0000-4000-8000-000000000005";

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function post(id: string, author: string, handle: string, venue: string | null, at: string): string {
  return "insert into public.social_posts (id, author_profile_id, author_handle, kind, visibility, body, venue_id, comment_policy, created_at) " +
    `values ('${id}', '${author}', '${handle}', 'standard', 'friends', 'A night', ${venue ? `'${venue}'` : "null"}, 'open', '${at}');`;
}

function attach(postId: string, author: string, rating: string): string {
  return asServiceRole(`select rating from public.attach_social_post_review('${postId}', '${author}', ${rating});`);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startMigratedPostgres({ label: "post-reviews", database: "pubmax_post_reviews" });
  const session = db();
  session.sql(
    `insert into public.profiles (id, handle) values ('${ALICE}', 'alice'), ('${BOB}', 'bob');`,
  );
  session.sql(post(POST_BEEHIVE, ALICE, "alice", "venue-beehive", "2026-10-01T18:00:00Z"));
  session.sql(post(POST_BEEHIVE_AGAIN, ALICE, "alice", "venue-beehive", "2026-10-08T18:00:00Z"));
  session.sql(post(POST_SOL, ALICE, "alice", "venue-sol", "2026-10-02T18:00:00Z"));
  session.sql(post(POST_NO_VENUE, ALICE, "alice", null, "2026-10-03T18:00:00Z"));
  session.sql(post(POST_BOB, BOB, "bob", "venue-sol", "2026-10-04T18:00:00Z"));
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0181 social post reviews", () => {
  it("attaches a half-step score to the author's own post that names a venue", () => {
    expect(db().sql(attach(POST_BEEHIVE, ALICE, "3.5"))).toBe("3.5");
    expect(db().sql(attach(POST_SOL, ALICE, "4.5"))).toBe("4.5");
    expect(db().sql(attach(POST_BOB, BOB, "2"))).toBe("2.0");
  });

  it("re-scoring a post replaces its score rather than adding a second", () => {
    expect(db().sql(attach(POST_BEEHIVE, ALICE, "4"))).toBe("4.0");
    expect(db().sql(`select count(*) from public.social_post_reviews where post_id = '${POST_BEEHIVE}';`)).toBe("1");
  });

  it("refuses a score off the scale, a stranger's post and a post with no venue", () => {
    expect(db().expectRefusal(attach(POST_SOL, ALICE, "4.25"))).toMatch(/invalid Social review rating/);
    expect(db().expectRefusal(attach(POST_SOL, ALICE, "0.5"))).toMatch(/invalid Social review rating/);
    expect(db().expectRefusal(attach(POST_SOL, ALICE, "5.5"))).toMatch(/invalid Social review rating/);
    expect(db().expectRefusal(attach(POST_BOB, ALICE, "5"))).toMatch(/post not found/);
    expect(db().expectRefusal(attach(POST_NO_VENUE, ALICE, "5"))).toMatch(/needs a venue/);
  });

  it("ranks one row per venue, the newest score, best first, and only the author's own", () => {
    db().sql(attach(POST_BEEHIVE_AGAIN, ALICE, "5"));
    const rows = db().sql(asServiceRole(
      `select venue_id || ':' || rating from public.read_own_social_pub_ranking('${ALICE}', 50);`,
    ));
    expect(rows.split("\n")).toEqual(["venue-beehive:5.0", "venue-sol:4.5"]);
  });

  it("follows the post: a removed post or a post edited off its venue drops out", () => {
    db().sql(`update public.social_posts set status = 'removed' where id = '${POST_BEEHIVE_AGAIN}';`);
    db().sql(`update public.social_posts set venue_id = null where id = '${POST_SOL}';`);
    const rows = db().sql(asServiceRole(
      `select venue_id || ':' || rating from public.read_own_social_pub_ranking('${ALICE}', 50);`,
    ));
    expect(rows.split("\n")).toEqual(["venue-beehive:4.0"]);
  });

  it("gives browser roles nothing on the table or the functions", () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(db().sql(`select has_table_privilege('${role}', 'public.social_post_reviews', 'select,insert,update,delete');`)).toBe("f");
      expect(db().sql(`select has_function_privilege('${role}', 'public.attach_social_post_review(uuid,uuid,numeric)', 'execute');`)).toBe("f");
      expect(db().sql(`select has_function_privilege('${role}', 'public.read_own_social_pub_ranking(uuid,integer)', 'execute');`)).toBe("f");
      expect(db().expectRefusal(asBrowserRole(role, ALICE, "select * from public.social_post_reviews;"))).toMatch(/permission denied/);
    }
  });

  it("deletes a post's score with the post", () => {
    db().sql(`delete from public.social_posts where id = '${POST_BOB}';`);
    expect(db().sql(`select count(*) from public.social_post_reviews where post_id = '${POST_BOB}';`)).toBe("0");
  });

  it("rolls back to no table and no functions, and a second rollback is a no-op", () => {
    db().applyFile(ROLLBACK);
    db().applyFile(ROLLBACK);
    expect(db().sql("select to_regclass('public.social_post_reviews') is null;")).toBe("t");
    expect(db().sql("select count(*) from pg_proc where proname in ('attach_social_post_review', 'read_own_social_pub_ranking');")).toBe("0");
    expect(db().sql("select count(*) from public.social_posts;")).toBe("4");
  });
});
