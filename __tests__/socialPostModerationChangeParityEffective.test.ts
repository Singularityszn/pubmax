// One rule, two copies: contentActuallyChanged in lib/socialPostStore.ts and
// v_moderation_changed in edit_social_post (0074). An edit sends a post back to
// moderation exactly when both say its content changed. Each field is changed
// on its own, and the two answers must match.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMemorySocialPostStore, type SocialPostActor } from "@/lib/socialPostStore";
import type { SocialPostFields } from "@/lib/socialPosts";
import { postgresSkipReason, startMigratedPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const AUTHOR = "a0740000-0000-4000-8000-000000000001";
const MEDIA_A = "a0740000-0000-4000-8000-00000000000a";
const MEDIA_B = "a0740000-0000-4000-8000-00000000000b";
const actor: SocialPostActor = { accountId: "account-parity", profileId: AUTHOR, handle: "parityauthor" };

const BASE: SocialPostFields = {
  kind: "standard", visibility: "public", body: "Base body", area: "camden", venueId: null,
  hashtags: ["night", "pub"], commentPolicy: "open", photo: { mediaId: MEDIA_A, altText: "Alt A" }, nameHidden: false,
};
const EDITS: Record<string, Partial<SocialPostFields>> = {
  "nothing": {},
  "kind": { kind: "feature_request" },
  "visibility": { visibility: "friends" },
  "body": { body: "Other body" },
  "area": { area: null },
  "venue": { venueId: "venue-parity" },
  "hashtag order": { hashtags: ["pub", "night"] },
  "hashtag count": { hashtags: ["night"] },
  "comment policy": { commentPolicy: "locked" },
  "photo removed": { photo: null },
  "photo media": { photo: { mediaId: MEDIA_B, altText: "Alt A" } },
  "photo description": { photo: { mediaId: MEDIA_A, altText: "Alt B" } },
};

let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("The test database is not running."); return session; }
const text = (value: string | null) => value === null ? "null" : `'${value.replaceAll("'", "''")}'`;

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "moderation-change-parity", database: "moderation_change_parity" });
  db().sql(`insert into public.profiles (id, handle) values ('${AUTHOR}', 'parityauthor')`);
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });

async function typescriptSaysChanged(edit: Partial<SocialPostFields>): Promise<boolean> {
  const store = createMemorySocialPostStore();
  const post = await store.create(actor, BASE);
  const edited = await store.edit(post.id, actor, 0, edit, true);
  return edited.revision !== post.revision;
}

/** One media row attaches to one post, so each case gets its own pair. */
function freshMedia(): Record<string, string> {
  const ids = db().sql(`insert into public.social_post_media(id,generation,owner_profile_id,object_key,sha256,width,height,byte_size,moderation_state)
    select media, generation, '${AUTHOR}', 'social/' || media::text || '/' || generation::text || '/image.jpg', '${"9".repeat(64)}', 200, 200, 400, 'approved'
    from (select gen_random_uuid() as media, gen_random_uuid() as generation from generate_series(1, 2)) as fresh
    returning id`).split("\n");
  return { [MEDIA_A]: ids[0]!, [MEDIA_B]: ids[1]! };
}

function sqlSaysChanged(edit: Partial<SocialPostFields>): boolean {
  const media = freshMedia();
  const next = { ...BASE, ...edit };
  const post = db().sql(`insert into public.social_posts(author_profile_id,author_handle,kind,visibility,body,area_slug,venue_id,hashtags,
      comment_policy,photo_media_id,photo_alt_text,moderation_state,moderated_at)
    values ('${AUTHOR}','parityauthor','${BASE.kind}','${BASE.visibility}',${text(BASE.body)},${text(BASE.area)},${text(BASE.venueId)},
      array[${BASE.hashtags.map(text).join(",")}]::text[],'${BASE.commentPolicy}','${media[BASE.photo!.mediaId]}',${text(BASE.photo!.altText)},'approved',now())
    returning id`);
  db().sql(`select count(*) from public.edit_social_post('${post}','${AUTHOR}',0,'${next.kind}','${next.visibility}',${text(next.body)},
    ${text(next.area)},${text(next.venueId)},array[${next.hashtags.map(text).join(",")}]::text[],'${next.commentPolicy}',
    ${next.photo ? `'${media[next.photo.mediaId]}'` : "null"},${text(next.photo?.altText ?? null)},false)`);
  return db().sql(`select moderation_state from public.social_posts where id='${post}'`) === "pending";
}

describe.skipIf(skipReason !== null)("an edit goes back to moderation: TypeScript and SQL agree", () => {
  it.each(Object.keys(EDITS))("%s", async (field) => {
    const edit = EDITS[field]!;
    expect(sqlSaysChanged(edit)).toBe(await typescriptSaysChanged(edit));
  });

  it("sends a body change back to moderation on both sides", async () => {
    expect([sqlSaysChanged({ body: "Changed" }), await typescriptSaysChanged({ body: "Changed" })]).toEqual([true, true]);
  });
});
