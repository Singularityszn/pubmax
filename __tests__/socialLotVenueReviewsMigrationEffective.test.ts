// Effective PostgreSQL proof for 0187 (your lot on one pub).
//
// A reader sees the scored posts their mutual friends wrote about one pub,
// newest first, and nothing else: not their own, not a one-way follower's,
// not a friend's private post, not another pub's, not a blocked author's.
// Browser roles hold nothing, and the rollback drops the function.

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
  "supabase/migrations/rollback/20261017180000_0187_social_lot_venue_reviews_rollback.sql",
);

const ME = "00000000-0000-4000-8000-000000000101";
const ANA = "00000000-0000-4000-8000-000000000102";
const BEN = "00000000-0000-4000-8000-000000000103";
const CAL = "00000000-0000-4000-8000-000000000104";

let database: PostgresSession | null = null;
let seq = 0;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function scored(author: string, handle: string, venue: string, rating: string, body: string, at: string, visibility = "friends"): void {
  seq += 1;
  const id = `50000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  db().sql(
    "insert into public.social_posts (id, author_profile_id, author_handle, kind, visibility, body, venue_id, comment_policy, moderation_state, created_at) " +
      `values ('${id}', '${author}', '${handle}', 'standard', '${visibility}', '${body}', '${venue}', 'open', 'approved', '${at}');`,
  );
  db().sql(asServiceRole(`select public.attach_social_post_review('${id}', '${author}', ${rating});`));
}

function reviews(viewer = ME, venue = "harp"): string[] {
  const rows = db().sql(asServiceRole(
    `select author_handle || ':' || rating || ':' || body from public.read_lot_venue_social_reviews('${viewer}', '${venue}', 20);`,
  ));
  return rows ? rows.split("\n") : [];
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startMigratedPostgres({ label: "lot-venue", database: "pubmax_lot_venue" });
  db().sql(`insert into public.profiles (id, handle) values ('${ME}', 'me'), ('${ANA}', 'ana'), ('${BEN}', 'ben'), ('${CAL}', 'cal');`);
  for (const friend of [ANA, BEN]) {
    db().sql(`insert into public.follows (follower_id, followee_id) values ('${ME}', '${friend}'), ('${friend}', '${ME}');`);
  }
  db().sql(`insert into public.follows (follower_id, followee_id) values ('${CAL}', '${ME}');`);
  scored(ANA, "ana", "harp", "5", "Best Harveys in town", "2026-10-08T18:00:00Z");
  scored(BEN, "ben", "harp", "3.5", "Rammed but fine", "2026-10-02T18:00:00Z");
  scored(BEN, "ben", "lamb", "4", "Lovely snug", "2026-10-03T18:00:00Z");
  scored(CAL, "cal", "harp", "1", "Hated it", "2026-10-04T18:00:00Z");
  scored(ME, "me", "harp", "2", "My own", "2026-10-05T18:00:00Z");
  scored(ANA, "ana", "harp", "4", "Private note", "2026-10-09T18:00:00Z", "private");
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0187 your lot on one pub", () => {
  it("lists mutual friends' scored posts about that pub, newest first", () => {
    expect(reviews()).toEqual(["ana:5.0:Best Harveys in town", "ben:3.5:Rammed but fine"]);
  });

  it("leaves out the reader, a one-way follower, a private post and another pub", () => {
    const rows = reviews().join(" ");
    for (const absent of ["My own", "Hated it", "Private note", "Lovely snug"]) expect(rows).not.toContain(absent);
    expect(reviews(ME, "lamb")).toEqual(["ben:4.0:Lovely snug"]);
  });

  it("drops a blocked friend and answers another reader only from their own lot", () => {
    db().sql(`insert into public.social_blocks (blocker_profile_id, blocked_profile_id) values ('${ANA}', '${ME}');`);
    expect(reviews()).toEqual(["ben:3.5:Rammed but fine"]);
    expect(reviews(CAL)).toEqual([]);
  });

  it("gives browser roles nothing", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(db().sql(`select has_function_privilege('${role}', 'public.read_lot_venue_social_reviews(uuid,text,integer)', 'execute');`)).toBe("f");
    }
  });

  it("rolls back to no function, and a second rollback is a no-op", () => {
    db().applyFile(ROLLBACK);
    db().applyFile(ROLLBACK);
    expect(db().sql("select count(*) from pg_proc where proname = 'read_lot_venue_social_reviews';")).toBe("0");
  });
});
