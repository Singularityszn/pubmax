// Effective PostgreSQL proof for 0183 (your lot's pubs).
//
// The friends' ranking averages each mutual friend's newest score per pub,
// counts only posts the reader may read, never the reader's own, never a
// blocked author and never a one-way follow. Browser roles hold nothing, and
// the rollback drops the one function.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20261017140000_0183_social_lot_pub_ranking_rollback.sql",
);

const ME = "00000000-0000-4000-8000-000000000001";
const ANA = "00000000-0000-4000-8000-000000000002";
const BEN = "00000000-0000-4000-8000-000000000003";
const CAL = "00000000-0000-4000-8000-000000000004";
const DEE = "00000000-0000-4000-8000-000000000005";

let database: PostgresSession | null = null;
let postSeq = 0;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function scored(author: string, handle: string, venue: string, rating: string, at: string, visibility = "friends"): void {
  postSeq += 1;
  const id = `30000000-0000-4000-8000-${String(postSeq).padStart(12, "0")}`;
  db().sql(
    "insert into public.social_posts (id, author_profile_id, author_handle, kind, visibility, body, venue_id, comment_policy, moderation_state, created_at) " +
      `values ('${id}', '${author}', '${handle}', 'standard', '${visibility}', 'Pint', '${venue}', 'open', 'approved', '${at}');`,
  );
  db().sql(asServiceRole(`select public.attach_social_post_review('${id}', '${author}', ${rating});`));
  db().sql(`update public.social_post_reviews set updated_at = '${at}' where post_id = '${id}';`);
}

function ranking(viewer = ME): string[] {
  const rows = db().sql(asServiceRole(
    `select venue_id || ':' || average_rating || ':' || rater_count || ':' || array_to_string(rater_handles, ',') from public.read_lot_social_pub_ranking('${viewer}', 50);`,
  ));
  return rows ? rows.split("\n") : [];
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startMigratedPostgres({ label: "lot-ranking", database: "pubmax_lot_ranking" });
  db().sql(
    `insert into public.profiles (id, handle) values ('${ME}', 'me'), ('${ANA}', 'ana'), ('${BEN}', 'ben'), ('${CAL}', 'cal'), ('${DEE}', 'dee');`,
  );
  // ME is mutual with ANA, BEN and DEE; CAL only follows ME one way.
  for (const friend of [ANA, BEN, DEE]) {
    db().sql(`insert into public.follows (follower_id, followee_id) values ('${ME}', '${friend}'), ('${friend}', '${ME}');`);
  }
  db().sql(`insert into public.follows (follower_id, followee_id) values ('${CAL}', '${ME}');`);
  scored(ANA, "ana", "harp", "3", "2026-10-01T18:00:00Z");
  scored(ANA, "ana", "harp", "5", "2026-10-08T18:00:00Z");
  scored(BEN, "ben", "harp", "4", "2026-10-02T18:00:00Z");
  scored(BEN, "ben", "lamb", "4.5", "2026-10-03T18:00:00Z");
  scored(CAL, "cal", "lamb", "1", "2026-10-04T18:00:00Z");
  scored(ME, "me", "lamb", "1", "2026-10-05T18:00:00Z");
  scored(DEE, "dee", "crown", "2", "2026-10-06T18:00:00Z", "private");
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0183 your lot's pubs", () => {
  it("averages each mutual friend's newest score per pub, best first", () => {
    expect(ranking()).toEqual(["harp:4.5:2:ana,ben", "lamb:4.5:1:ben"]);
  });

  it("leaves out the reader's own score, a one-way follower and a friend's private post", () => {
    const rows = ranking().join(" ");
    expect(rows).not.toContain("cal");
    expect(rows).not.toContain("crown");
    expect(rows).not.toContain("me");
  });

  it("drops a friend the reader has blocked, and a held post", () => {
    db().sql(`insert into public.social_blocks (blocker_profile_id, blocked_profile_id) values ('${ME}', '${BEN}');`);
    expect(ranking()).toEqual(["harp:5.0:1:ana"]);
    db().sql(`delete from public.social_blocks where blocker_profile_id = '${ME}';`);
    db().sql(`update public.social_posts set moderation_state = 'needs_review' where author_profile_id = '${BEN}' and venue_id = 'lamb';`);
    expect(ranking()).toEqual(["harp:4.5:2:ana,ben"]);
  });

  it("answers only for the reader asked about: another account sees its own lot", () => {
    expect(ranking(CAL)).toEqual([]);
  });

  it("gives browser roles nothing", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(db().sql(`select has_function_privilege('${role}', 'public.read_lot_social_pub_ranking(uuid,integer)', 'execute');`)).toBe("f");
    }
  });

  it("rolls back to no function, and a second rollback is a no-op", () => {
    db().applyFile(ROLLBACK);
    db().applyFile(ROLLBACK);
    expect(db().sql("select count(*) from pg_proc where proname = 'read_lot_social_pub_ranking';")).toBe("0");
    expect(db().sql("select count(*) > 0 from public.social_post_reviews;")).toBe("t");
  });
});
