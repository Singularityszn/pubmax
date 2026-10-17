// Effective PostgreSQL proof for 0185 (Social extra photos).
//
// Photos 2 to 4 attach only to the author's own post that already has a first
// photo, one per position. Each is screened on its own: its author reads it at
// once, a friend only once it is approved and only while they may read the
// post. Browser roles hold nothing, and the rollback leaves the first photo.

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
  "supabase/migrations/rollback/20261017160000_0185_social_post_extra_photos_rollback.sql",
);

const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const EVE = "00000000-0000-4000-8000-0000000000e5";
const FIRST_MEDIA = "40000000-0000-4000-8000-000000000001";
const GEN = "40000000-0000-4000-8000-0000000000ff";
const POST = "41000000-0000-4000-8000-000000000001";
const NO_PHOTO_POST = "41000000-0000-4000-8000-000000000002";
const EXTRA = ["42000000-0000-4000-8000-000000000002", "42000000-0000-4000-8000-000000000003", "42000000-0000-4000-8000-000000000004"];
const SHA = "a".repeat(64);

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function attach(post: string, owner: string, media: string, position: number): string {
  return asServiceRole(
    `select moderation_state from public.attach_social_post_extra_photo('${post}', '${owner}', '${media}', ${position}, '${SHA}', 800, 1000, 1234, 'The snug');`,
  );
}

function visible(viewer: string): string {
  const rows = db().sql(asServiceRole(
    `select slot || ':' || moderation_state from public.read_social_post_extra_photos(array['${POST}']::uuid[], '${viewer}');`,
  ));
  return rows || "none";
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startMigratedPostgres({ label: "extra-photos", database: "pubmax_extra_photos" });
  db().sql(`insert into public.profiles (id, handle) values ('${ALICE}', 'alice'), ('${BOB}', 'bob'), ('${EVE}', 'eve');`);
  db().sql(`insert into public.follows (follower_id, followee_id) values ('${ALICE}', '${BOB}'), ('${BOB}', '${ALICE}');`);
  db().sql(
    "insert into public.social_post_media (id, generation, owner_profile_id, object_key, sha256, width, height, byte_size) " +
      `values ('${FIRST_MEDIA}', '${GEN}', '${ALICE}', 'social/${FIRST_MEDIA}/${GEN}/image.jpg', '${SHA}', 800, 1000, 1234);`,
  );
  db().sql(
    "insert into public.social_posts (id, author_profile_id, author_handle, kind, visibility, body, comment_policy, photo_media_id, photo_alt_text, moderation_state) " +
      `values ('${POST}', '${ALICE}', 'alice', 'standard', 'friends', 'Snug crawl', 'open', '${FIRST_MEDIA}', 'The front bar', 'approved'), ` +
      `('${NO_PHOTO_POST}', '${ALICE}', 'alice', 'standard', 'friends', 'Words only', 'open', null, null, 'approved');`,
  );
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0185 social extra photos", () => {
  it("attaches photos 2 to 4 to the author's own post with a first photo, held pending", () => {
    expect(db().sql(attach(POST, ALICE, EXTRA[0]!, 2))).toBe("pending");
    expect(db().sql(attach(POST, ALICE, EXTRA[1]!, 3))).toBe("pending");
    expect(db().sql(`select object_key from public.social_post_extra_photos where media_id = '${EXTRA[0]}';`)).toBe(`social-extra/${EXTRA[0]}/image.jpg`);
  });

  it("refuses a stranger's post, a post with no first photo, a taken or out-of-range position", () => {
    expect(db().expectRefusal(attach(POST, BOB, EXTRA[2]!, 4))).toMatch(/post not found/);
    expect(db().expectRefusal(attach(NO_PHOTO_POST, ALICE, EXTRA[2]!, 2))).toMatch(/needs a first photo/);
    expect(db().expectRefusal(attach(POST, ALICE, EXTRA[2]!, 2))).toMatch(/duplicate key/);
    expect(db().expectRefusal(attach(POST, ALICE, EXTRA[2]!, 5))).toMatch(/invalid Social extra photo position/);
    expect(db().expectRefusal(attach(POST, ALICE, EXTRA[2]!, 1))).toMatch(/invalid Social extra photo position/);
  });

  it("shows a pending photo to its author only, and an approved one to a friend but not a stranger", () => {
    expect(visible(ALICE)).toBe("2:pending\n3:pending");
    expect(visible(BOB)).toBe("none");
    const claimed = db().sql(asServiceRole("select media_id || '|' || lease_token from public.claim_social_extra_photo_moderation(10) order by media_id;")).split("\n");
    expect(claimed).toHaveLength(2);
    const [media2, lease2] = claimed[0]!.split("|");
    const [media3, lease3] = claimed[1]!.split("|");
    expect(db().sql(asServiceRole(`select public.complete_social_extra_photo_moderation('${media2}', '${lease2}', 'approved', null);`))).toBe("t");
    expect(db().sql(asServiceRole(`select public.complete_social_extra_photo_moderation('${media3}', '${lease3}', 'needs_review', null);`))).toBe("t");
    expect(visible(BOB)).toBe("2:approved");
    expect(visible(EVE)).toBe("none");
    expect(db().sql(asServiceRole(`select count(*) from public.read_social_post_extra_photo_object('${BOB}', '${media3}');`))).toBe("0");
    expect(db().sql(asServiceRole(`select count(*) from public.read_social_post_extra_photo_object('${ALICE}', '${media3}');`))).toBe("1");
  });

  it("refuses a stale lease, and a retry puts the photo back in the queue later", () => {
    db().sql(attach(POST, ALICE, EXTRA[2]!, 4));
    const [media, lease] = db().sql(asServiceRole("select media_id || '|' || lease_token from public.claim_social_extra_photo_moderation(10);")).split("|");
    expect(db().sql(asServiceRole(`select public.complete_social_extra_photo_moderation('${media}', gen_random_uuid(), 'approved', null);`))).toBe("f");
    expect(db().sql(asServiceRole(`select public.complete_social_extra_photo_moderation('${media}', '${lease}', null, now() + interval '10 minutes');`))).toBe("t");
    expect(db().sql(asServiceRole("select count(*) from public.claim_social_extra_photo_moderation(10);"))).toBe("0");
  });

  it("hides every extra photo from a friend the author has blocked", () => {
    db().sql(`insert into public.social_blocks (blocker_profile_id, blocked_profile_id) values ('${ALICE}', '${BOB}');`);
    expect(visible(BOB)).toBe("none");
    db().sql(`delete from public.social_blocks where blocker_profile_id = '${ALICE}';`);
  });

  it("gives browser roles nothing", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(db().sql(`select has_table_privilege('${role}', 'public.social_post_extra_photos', 'select,insert,update,delete');`)).toBe("f");
      expect(db().sql(`select has_function_privilege('${role}', 'public.read_social_post_extra_photos(uuid[],uuid)', 'execute');`)).toBe("f");
      expect(db().sql(`select has_function_privilege('${role}', 'public.attach_social_post_extra_photo(uuid,uuid,uuid,integer,text,integer,integer,integer,text)', 'execute');`)).toBe("f");
    }
  });

  it("rolls back to the first photo alone, and a second rollback is a no-op", () => {
    db().applyFile(ROLLBACK);
    db().applyFile(ROLLBACK);
    expect(db().sql("select to_regclass('public.social_post_extra_photos') is null;")).toBe("t");
    expect(db().sql(`select photo_media_id from public.social_posts where id = '${POST}';`)).toBe(FIRST_MEDIA);
  });
});
