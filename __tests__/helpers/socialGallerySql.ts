import { join } from "node:path";
import { expect } from "vitest";
import type { PostgresSession } from "./postgres";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const STAFF = "55555555-5555-4555-8555-555555555555";
const media = (n: number) => `15500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sqlJson = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const items = (...numbers: number[]) => numbers.map((n) => ({ mediaId: media(n), altText: `Photo ${n}` }));
const payload = (gallery = items(1, 2)) => ({ kind: "standard", visibility: "friends", body: "A walk with friends", area: null, venueId: null, hashtags: [], commentPolicy: "open", gallery });
const create = (value: unknown, key = "gallery-create-key-155", actor = ALICE) => `select id from public.create_social_post_gallery_idempotent('${actor}',${sqlJson(value)},'${key}','${"a".repeat(64)}')`;
const edit = (postId: string, version: number, gallery: ReturnType<typeof items>, key: string, fields = {}) => `select post->>'id' from public.edit_social_post_gallery_idempotent('${ALICE}',${sqlJson({ postId, expectedMutationVersion: version, gallery, ...fields })},'${key}','${"b".repeat(64)}')`;
const forward = join(process.cwd(), "supabase/migrations/20260908010000_0155_social_galleries.sql");
const rollback = join(process.cwd(), "supabase/migrations/rollback/20260908010000_0155_social_galleries_rollback.sql");
const video = join(process.cwd(), "supabase/migrations/20260907160000_0154_social_video.sql");
const videoRollback = join(process.cwd(), "supabase/migrations/rollback/20260907160000_0154_social_video_rollback.sql");

function reserve(db: PostgresSession, n: number, owner = ALICE, ready = true) {
  const row = JSON.parse(db.sql(`select row_to_json(x) from public.reserve_social_post_media_upload('${owner}','${media(n)}','${"c".repeat(64)}',640,480,1024) x`));
  if (ready) expect(db.sql(`select public.mark_social_gallery_upload_ready('${owner}','${media(n)}','${row.generation}')`)).toBe("t");
  return row;
}
function claim(db: PostgresSession, postId: string) {
  const result = db.sql(`select row_to_json(x) from public.claim_social_post_moderation_jobs(50) x where post_id='${postId}'`);
  expect(result).not.toBe("");
  return JSON.parse(result);
}
function complete(db: PostgresSession, postId: string, job: { revision: number; media_id: string | null; lease_token: string }, decision: string) {
  return db.sql(`select public.complete_social_post_moderation_job('${postId}',${job.revision},${job.media_id ? `'${job.media_id}'` : "null"},'${job.lease_token}','${decision}',null,null)`);
}
function manifest(db: PostgresSession, postId: string, job: { revision: number; lease_token: string }) {
  return JSON.parse(db.sql(`select public.read_social_gallery_moderation_manifest('${postId}',${job.revision},'${job.lease_token}')`));
}

/** Uses the existing composer suite's cluster and fixtures, before its final rollback. */
export async function proveSocialGallerySql(db: PostgresSession): Promise<void> {
  db.applyFileTransactional(video);
  const restoredFunctions = `select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'grants',p.proacl::text) order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
    ('edit_social_post','claim_social_post_media_upload_cleanup','reserve_social_post_media_upload','social_post_digest','complete_social_post_moderation_job',
    'moderate_social_post_admin','moderate_social_post','remove_social_post_idempotent','read_social_post_media',
    'read_social_post_media_admin','read_social_post_moderation_queue_admin','guard_social_post_photo_owner','queue_social_post_moderation')`;
  const previousFunctions = db.sql(restoredFunctions);
  db.applyFileTransactional(forward);
  expect(db.sql("select has_table_privilege('authenticated','public.social_post_gallery','select')")).toBe("f");
  for (const fn of ["mark_social_gallery_upload_ready(uuid,uuid,uuid)", "read_social_gallery_uploads(uuid,uuid[])", "create_social_post_gallery_idempotent(uuid,jsonb,text,text)", "edit_social_post_gallery_idempotent(uuid,jsonb,text,text)", "read_social_gallery_moderation_manifest(uuid,integer,uuid)", "moderate_social_post_gallery_admin(uuid,uuid,uuid,integer,text,uuid[])"]) {
    expect(db.sql(`select has_function_privilege('anon','public.${fn}','execute') or has_function_privilege('authenticated','public.${fn}','execute')`)).toBe("f");
    expect(db.sql(`select has_function_privilege('service_role','public.${fn}','execute')`)).toBe("t");
  }
  const first = reserve(db, 1, ALICE, false);
  reserve(db, 2);
  expect(db.sql(`select public.mark_social_gallery_upload_ready('${BOB}','${media(1)}','${first.generation}')`)).toBe("f");
  expect(db.sql(`select public.mark_social_gallery_upload_ready('${ALICE}','${media(1)}','${media(99)}')`)).toBe("f");
  expect(db.expectRefusal(create(payload()))).toMatch(/reservation/);
  expect(db.sql(`select count(*) from public.social_post_media where id in ('${media(1)}','${media(2)}')`)).toBe("0");
  expect(db.sql(`select public.mark_social_gallery_upload_ready('${ALICE}','${media(1)}','${first.generation}')`)).toBe("t");
  const readyRows = JSON.parse(db.sql(`select json_agg(x) from public.read_social_gallery_uploads('${ALICE}',array['${media(2)}','${media(1)}']::uuid[]) x`));
  expect(readyRows.map((row: { media_id: string }) => row.media_id)).toEqual([media(2), media(1)]);
  expect(db.sql(`select count(*) from public.read_social_gallery_uploads('${BOB}',array['${media(1)}']::uuid[])`)).toBe("0");
  expect(db.expectRefusal(create(payload(items(1, 1))))).toMatch(/duplicate/);
  expect(db.expectRefusal(create(payload(items(...Array.from({ length: 11 }, (_, i) => i + 1)))))).toMatch(/invalid Social gallery/);
  expect(db.expectRefusal(create({ ...payload(), gallery: [{ mediaId: media(1), altText: "" }] }))).toMatch(/invalid Social gallery/);
  expect(db.expectRefusal(create({ ...payload(), actor: BOB }))).toMatch(/payload/);
  // Force a late association failure after the base post function has written its primary.
  db.sql("alter table public.social_post_gallery add constraint gallery_test_late_failure check(position<>2)");
  expect(db.expectRefusal(create(payload()))).toMatch(/gallery_test_late_failure/);
  expect(db.sql(`select count(*) from public.social_post_media_uploads where media_id in ('${media(1)}','${media(2)}')`)).toBe("2");
  expect(db.sql(`select count(*) from public.social_post_create_requests where idempotency_key='gallery-create-key-155'`)).toBe("0");
  expect(db.sql(`select count(*) from public.social_post_media where id in ('${media(1)}','${media(2)}')`)).toBe("0");
  db.sql("alter table public.social_post_gallery drop constraint gallery_test_late_failure");
  const results = await db.concurrentResults([create(payload()), create(payload())]);
  expect(results[0]).toBe(results[1]);
  const postId = results[0];
  expect(postId).toMatch(/^[a-f0-9-]{36}$/);
  expect(db.sql(`select count(*) from public.social_post_create_requests where idempotency_key='gallery-create-key-155'`)).toBe("1");
  expect(db.sql(`select count(*) from public.social_post_media_uploads where media_id in ('${media(1)}','${media(2)}')`)).toBe("0");
  expect(JSON.parse(db.sql(`select gallery_photos from public.social_posts where id='${postId}'`))).toEqual(items(1, 2));
  expect(db.sql(`select photo_media_id from public.social_posts where id='${postId}'`)).toBe(media(1));
  expect(db.sql(create(payload()))).toBe(postId);
  expect(db.expectRefusal(create(payload(items(2, 1))))).toMatch(/idempotency conflict/);
  expect(db.expectRefusal(create(payload([{ mediaId: media(1), altText: "Changed" }, ...items(2)])))).toMatch(/idempotency conflict/);
  expect(db.expectRefusal(`select * from public.reserve_social_post_media_upload('${ALICE}','${media(1)}','${"c".repeat(64)}',640,480,1024)`)).toMatch(/already attached/);
  expect(db.expectRefusal(create(payload(items(1)), "gallery-second-post-155"))).toMatch(/reservation|already attached/);
  expect(db.expectRefusal(`update public.social_posts set gallery_photos='[]' where id='${postId}'`)).toMatch(/projection/);
  expect(db.expectRefusal(`update public.social_post_gallery set position=10 where post_id='${postId}' and media_id='${media(2)}'`)).toMatch(/contiguous/);
  expect(db.expectRefusal(`select * from public.edit_social_post('${postId}','${ALICE}',0,'standard','friends','A walk with friends',null,null,'{}','open',null,null,true)`)).toMatch(/gallery edit/);

  const job = claim(db, postId);
  // A previous-release worker only scans the primary and never reads the gallery manifest.
  expect(complete(db, postId, job, "approved")).toBe("f");
  expect(complete(db, postId, job, "needs_review")).toBe("f");
  expect(manifest(db, postId, job)).toMatchObject({ gallery: true, items: [{ mediaId: media(1), position: 1 }, { mediaId: media(2), position: 2 }] });
  expect(db.sql(`select public.read_social_gallery_moderation_manifest('${postId}',0,'${media(99)}') is null`)).toBe("t");
  expect(complete(db, postId, { ...job, revision: 1 }, "approved")).toBe("f");
  expect(complete(db, postId, job, "needs_review")).toBe("t");
  for (const n of [1, 2]) {
    expect(db.sql(`select count(*) from public.read_social_post_media('${ALICE}','${media(n)}')`)).toBe("0");
    expect(db.sql(`select count(*) from public.read_social_post_media_admin('${STAFF}','${media(n)}')`)).toBe("1");
  }
  expect(db.sql(`select public.moderate_social_post_admin('${STAFF}','${postId}','${media(1)}',1,'approve')`)).toBe("f");
  expect(db.sql(`select public.moderate_social_post_admin('${STAFF}','${postId}','${media(1)}',0,'approve')`)).toBe("f");
  for (const reviewed of ["null", "array[]::uuid[]", `array['${media(1)}']::uuid[]`, `array['${media(1)}','${media(99)}']::uuid[]`, `array['${media(2)}','${media(1)}']::uuid[]`]) {
    expect(db.sql(`select public.moderate_social_post_gallery_admin('${STAFF}','${postId}','${media(1)}',0,'approve',${reviewed})`)).toBe("f");
  }
  expect(db.sql(`select public.moderate_social_post_gallery_admin('${STAFF}','${postId}','${media(1)}',1,'approve',array['${media(1)}','${media(2)}']::uuid[])`)).toBe("f");
  expect(db.sql(`select count(*) from public.social_post_moderation_actions where post_id='${postId}'`)).toBe("0");
  // Older staff clients can still hide a gallery. Roll back to continue the approval journey.
  db.sql(`begin; do $$ begin
    if not public.moderate_social_post_admin('${STAFF}','${postId}','${media(1)}',0,'hide')
      then raise exception 'legacy gallery hide refused'; end if;
    if not exists(select 1 from public.social_posts where id='${postId}' and status='hidden')
      then raise exception 'gallery was not hidden'; end if;
  end $$; rollback;`);
  expect(db.sql(`select public.moderate_social_post_gallery_admin('${STAFF}','${postId}','${media(1)}',0,'approve',array['${media(1)}','${media(2)}']::uuid[])`)).toBe("t");
  expect(db.sql(`select count(*) from public.social_post_media where id in ('${media(1)}','${media(2)}') and moderation_state='approved'`)).toBe("2");
  for (const n of [1, 2]) {
    expect(db.sql(`select count(*) from public.read_social_post_media('${BOB}','${media(n)}')`)).toBe("1");
    expect(db.sql(`select count(*) from public.read_social_post_media('${CAROL}','${media(n)}')`)).toBe("0");
  }
  db.sql(`insert into public.social_blocks(blocker_profile_id,blocked_profile_id) values('${ALICE}','${BOB}') on conflict do nothing`);
  expect(db.sql(`select count(*) from public.read_social_post_media('${BOB}','${media(2)}')`)).toBe("0");
  db.sql(`delete from public.social_blocks where blocker_profile_id='${ALICE}' and blocked_profile_id='${BOB}'`);

  // A legacy caller cannot make another post point to a gallery's secondary photo.
  const otherPost = db.sql(`select id from public.create_social_post('${ALICE}','alice','standard','private','Other post',null,null,'{}','open',null,null,null,null,null,null,null,'{}')`);
  expect(db.expectRefusal(`select * from public.edit_social_post('${otherPost}','${ALICE}',0,'standard','private','Other post',null,null,'{}','open','${media(2)}','Stolen secondary',true)`)).toMatch(/another post/);
  // A held secondary item still makes the whole gallery available for staff review.
  db.sql(`update public.social_post_media set moderation_state='needs_review' where id='${media(2)}'`);
  expect(db.sql(`select count(*) from public.read_social_post_moderation_queue_admin('${STAFF}',50) where post_id='${postId}'`)).toBe("1");
  for (const n of [1, 2]) expect(db.sql(`select count(*) from public.read_social_post_media_admin('${STAFF}','${media(n)}')`)).toBe("1");
  expect(db.sql(`select public.moderate_social_post_gallery_admin('${STAFF}','${postId}','${media(1)}',0,'approve',array['${media(1)}','${media(2)}']::uuid[])`)).toBe("t");

  expect(db.sql(edit(postId, 0, items(2, 1), "gallery-reorder-key-155"))).toBe(postId);
  expect(db.sql(`select mutation_version || ':' || revision || ':' || photo_media_id from public.social_posts where id='${postId}'`)).toBe(`1:1:${media(2)}`);
  expect(db.sql(`select count(*) from public.social_post_media_lifecycle_events where post_id='${postId}'`)).toBe("0");
  expect(db.sql(`select count(*) from public.social_post_edit_audit where post_id='${postId}' and to_mutation_version=1`)).toBe("1");
  expect(db.sql(edit(postId, 0, items(2, 1), "gallery-reorder-key-155"))).toBe(postId);
  expect(db.expectRefusal(edit(postId, 0, items(1, 2), "gallery-stale-key-155"))).toMatch(/edit conflict/);
  expect(complete(db, postId, job, "approved")).toBe("f");
  const reorderJob = claim(db, postId);
  const swapped = manifest(db, postId, reorderJob);
  expect(swapped.items.map((item: { mediaId: string }) => item.mediaId)).toEqual([media(2), media(1)]);
  reserve(db, 3);
  reserve(db, 4, BOB);
  expect(db.expectRefusal(edit(postId, 1, items(2, 3, 4), "gallery-foreign-key-155"))).toMatch(/reservation/);
  expect(db.sql(`select count(*) from public.social_post_media_uploads where media_id='${media(3)}'`)).toBe("1");
  expect(db.sql(`select mutation_version from public.social_posts where id='${postId}'`)).toBe("1");
  expect(db.sql(edit(postId, 1, items(2, 3), "gallery-replace-key-155"))).toBe(postId);
  expect(db.sql(`select attachment_state from public.social_post_media where id='${media(1)}'`)).toBe("detached");
  expect(db.sql(`select count(*) from public.social_post_media_lifecycle_events where post_id='${postId}' and media_id='${media(1)}' and action='detached'`)).toBe("1");
  expect(db.sql(`select count(*) from public.social_post_media_lifecycle_events where post_id='${postId}' and media_id='${media(2)}'`)).toBe("0");
  expect(complete(db, postId, reorderJob, "approved")).toBe("f");
  const replacementJob = claim(db, postId);
  expect(complete(db, postId, replacementJob, "approved")).toBe("f");
  expect(manifest(db, postId, replacementJob).items).toHaveLength(2);
  expect(complete(db, postId, replacementJob, "approved")).toBe("t");
  expect(db.sql(`select count(*) from public.read_social_post_media('${ALICE}','${media(1)}')`)).toBe("0");
  expect(db.sql(`select count(*) from public.read_social_post_media('${BOB}','${media(3)}')`)).toBe("1");
  expect(db.sql(edit(postId, 2, items(2, 3), "gallery-private-key-155", { visibility: "private" }))).toBe(postId);
  expect(db.sql(`select mutation_version || ':' || revision from public.social_posts where id='${postId}'`)).toBe("3:2");
  expect(db.sql(`select count(*) from public.read_social_post_media('${BOB}','${media(3)}')`)).toBe("0");
  expect(() => db.applyFileTransactional(rollback)).toThrow(/Remove galleries/);
  expect(db.sql(edit(postId, 3, [], "gallery-empty-key-155"))).toBe(postId);
  expect(db.sql(`select gallery_photos || jsonb_build_array(photo_media_id) from public.social_posts where id='${postId}'`)).toBe("[null]");
  const emptyJob = claim(db, postId);
  expect(manifest(db, postId, emptyJob)).toEqual({ gallery: false, items: [] });
  expect(complete(db, postId, emptyJob, "needs_review")).toBe("t");
  expect(db.sql(`select public.moderate_social_post_admin('${STAFF}','${postId}',null,${emptyJob.revision},'approve')`)).toBe("t");
  expect(db.sql(`select count(*) from public.social_post_media_lifecycle_events where post_id='${postId}' and action='detached'`)).toBe("3");

  // Unready, expired, cleanup-claimed and non-JPEG reservations cannot be consumed.
  const expired = reserve(db, 5);
  db.sql(`update public.social_post_media_uploads set created_at=now()-interval '25 hours' where media_id='${media(5)}'`);
  expect(db.expectRefusal(create(payload(items(5)), "gallery-expired-key-155"))).toMatch(/reservation/);
  expect(db.expectRefusal(`select * from public.reserve_social_post_media_upload('${ALICE}','${media(5)}','${"c".repeat(64)}',640,480,1024)`)).toMatch(/expired/);
  expect(db.sql(`select public.mark_social_gallery_upload_ready('${ALICE}','${media(5)}','${expired.generation}')`)).toBe("f");
  expect(db.sql(`select count(*) from public.read_social_gallery_uploads('${ALICE}',array['${media(5)}']::uuid[])`)).toBe("0");
  const cleanupReady = reserve(db, 6, ALICE, false);
  db.sql(`select * from public.claim_social_post_media_upload_cleanup('${ALICE}','${media(6)}','${cleanupReady.generation}')`);
  expect(db.expectRefusal(create(payload(items(6)), "gallery-cleanup-key-155"))).toMatch(/reservation/);
  reserve(db, 7); reserve(db, 8);
  const removedPost = db.sql(create(payload(items(7, 8)), "gallery-remove-key-155"));
  expect(db.sql(`select public.remove_social_post_idempotent('${removedPost}','${ALICE}',0,'gallery-whole-remove-155')`)).toBe("t");
  expect(db.sql(`select count(*) from public.social_post_gallery where post_id='${removedPost}'`)).toBe("0");
  expect(db.sql(`select count(*) from public.social_post_media where id in ('${media(7)}','${media(8)}') and attachment_state='detached'`)).toBe("2");
  // Existing photo and video RPCs still work under the new schema without readiness markers.
  const legacyPhoto = reserve(db, 9, ALICE, false);
  const legacyPost = db.sql(`select id from public.create_social_post('${ALICE}','alice','standard','private','Legacy photo',null,null,'{}','open',
    '${media(9)}','${legacyPhoto.object_key}','${"c".repeat(64)}',640,480,1024,'Legacy photo','{}')`);
  expect(db.sql(`select gallery_photos is null from public.social_posts where id='${legacyPost}'`)).toBe("t");
  const legacyJob = claim(db, legacyPost);
  expect(manifest(db, legacyPost, legacyJob)).toEqual({ gallery: false, items: [] });
  expect(complete(db, legacyPost, legacyJob, "approved")).toBe("t");
  expect(db.sql(`select public.remove_social_post_idempotent('${legacyPost}','${ALICE}',0,'gallery-legacy-remove-155')`)).toBe("t");
  const videoKey = db.sql(`select object_key from public.reserve_social_post_video_upload('${ALICE}','${media(10)}','${"d".repeat(64)}',1080,1920,1024,2)`);
  const legacyVideo = db.sql(`select id from public.create_social_post('${ALICE}','alice','standard','private','Legacy video',null,null,'{}','open',
    '${media(10)}','${videoKey}','${"d".repeat(64)}',1080,1920,1024,'Legacy video','{}')`);
  const videoJob = claim(db, legacyVideo);
  expect(manifest(db, legacyVideo, videoJob)).toEqual({ gallery: false, items: [] });
  expect(complete(db, legacyVideo, videoJob, "needs_review")).toBe("t");
  expect(db.sql(`select count(*) from public.read_social_post_media_admin('${STAFF}','${media(10)}')`)).toBe("1");
  expect(db.sql(`select public.moderate_social_post_admin('${STAFF}','${legacyVideo}','${media(10)}',${videoJob.revision},'approve')`)).toBe("t");
  expect(db.sql(`select public.remove_social_post_idempotent('${legacyVideo}','${ALICE}',0,'gallery-video-remove-155')`)).toBe("t");
  const ten = Array.from({ length: 10 }, (_, i) => i + 11);
  for (const n of ten) reserve(db, n);
  const tenPost = db.sql(create(payload(items(...ten)), "gallery-ten-photos-155"));
  expect(db.sql(`select jsonb_array_length(gallery_photos) from public.social_posts where id='${tenPost}'`)).toBe("10");
  expect(db.sql(`select public.remove_social_post_idempotent('${tenPost}','${ALICE}',0,'gallery-ten-remove-155')`)).toBe("t");
  // Two requests can reserve the same generation before either writes its bytes.
  const winner = reserve(db, 21, ALICE, false);
  const duplicate = reserve(db, 21, ALICE, false);
  expect(duplicate.generation).toBe(winner.generation);
  expect(db.sql(`select public.mark_social_gallery_upload_ready('${ALICE}','${media(21)}','${winner.generation}')`)).toBe("t");
  const losingCleanup = db.sql(`select count(*) from public.claim_social_post_media_upload_cleanup('${ALICE}','${media(21)}','${duplicate.generation}')`);
  expect(losingCleanup, "a failed duplicate must not claim the ready winner").toBe("0");
  expect(db.sql(`select count(*) from public.read_social_gallery_uploads('${ALICE}',array['${media(21)}']::uuid[])`)).toBe("1");

  const winnerPost = db.sql(create(payload(items(21)), "gallery-winner-create-155"));
  expect(db.sql(`select public.remove_social_post_idempotent('${winnerPost}','${ALICE}',0,'gallery-winner-remove-155')`)).toBe("t");
  const expiredClaims = JSON.parse(db.sql(`select coalesce(json_agg(x),'[]') from public.claim_social_post_media_upload_cleanup_batch(100,now()-interval '24 hours') x where media_id='${media(5)}'`));
  expect(expiredClaims).toHaveLength(1);
  const expiredClaim = expiredClaims[0];
  expect(db.sql(`select public.finalize_social_post_media_upload_cleanup('${media(5)}','${expiredClaim.generation}','${expiredClaim.cleanup_token}')`)).toBe("t");

  reserve(db, 22); reserve(db, 23);
  const hiddenPost = db.sql(create(payload(items(22, 23)), "gallery-hidden-drain-155"));
  const hiddenJob = claim(db, hiddenPost);
  manifest(db, hiddenPost, hiddenJob);
  expect(complete(db, hiddenPost, hiddenJob, "needs_review")).toBe("t");
  expect(db.sql(`select public.moderate_social_post_gallery_admin('${STAFF}','${hiddenPost}','${media(22)}',0,'hide',null)`)).toBe("t");
  expect(db.sql(`select status from public.social_posts where id='${hiddenPost}'`)).toBe("hidden");
  expect(db.sql(`select count(*) from public.read_social_post_media('${ALICE}','${media(22)}')`)).toBe("0");
  expect(db.sql(`select public.remove_social_post_idempotent('${hiddenPost}','${BOB}',0,'gallery-hidden-foreign-155')`)).toBe("f");
  expect(db.sql(`select public.remove_social_post_idempotent('${hiddenPost}','${ALICE}',1,'gallery-hidden-stale-155')`)).toBe("f");
  expect(db.sql(`select public.remove_social_post_idempotent('${hiddenPost}','${ALICE}',0,'gallery-hidden-remove-155')`), "a hidden gallery must support removal without restore").toBe("t");
  expect(db.sql(`select count(*) from public.social_post_gallery where post_id='${hiddenPost}'`)).toBe("0");
  expect(db.sql(`select count(*) from public.read_social_post_media('${ALICE}','${media(22)}')`)).toBe("0");

  reserve(db, 24);
  const receiptPost = db.sql(create(payload(items(24)), "gallery-receipt-create-155"));
  const receiptA = edit(receiptPost, 0, items(24), "gallery-receipt-a-155", { body: "First caption" });
  const receiptNoOp = edit(receiptPost, 1, items(24), "gallery-receipt-noop-155", { body: "First caption" });
  db.sql(receiptA);
  db.sql(receiptNoOp);
  db.sql(edit(receiptPost, 1, items(24), "gallery-receipt-b-155", { body: "Later caption" }));
  for (const [request, from, to] of [[receiptA, 0, 1], [receiptNoOp, 1, 1]] as const) {
    const receipt = JSON.parse(db.sql(request.replace(/^select post->>'id' from /, "select to_jsonb(x) from ") + " x"));
    expect(receipt, "replay must keep the original edit receipt with the current post").toMatchObject({
      post: { id: receiptPost, body: "Later caption", mutation_version: 2 },
      from_mutation_version: from, to_mutation_version: to,
    });
  }
  expect(db.sql(`select public.remove_social_post_idempotent('${receiptPost}','${ALICE}',2,'gallery-receipt-remove-155')`)).toBe("t");

  db.sql(`update public.social_post_media set retention_expires_at=now()-interval '1 day' where id::text like '15500000-%'`);
  const cleanupRows = JSON.parse(db.sql(`select coalesce(json_agg(x),'[]') from public.claim_social_post_media_cleanup_batch(100) x where media_id::text like '15500000-%'`));
  for (const row of cleanupRows) expect(db.sql(`select public.finalize_social_post_media_cleanup('${row.media_id}','${row.generation}','${row.cleanup_token}')`)).toBe("t");
  expect(db.sql(`select count(*) from public.social_post_media where id::text like '15500000-%'`)).toBe("0");
  db.applyFileTransactional(rollback);
  const restored = JSON.parse(db.sql(restoredFunctions));
  const previous = JSON.parse(previousFunctions);
  expect(restored).toHaveLength(previous.length);
  for (const [index, fn] of previous.entries()) expect(restored[index], fn.name).toEqual(fn);
  expect(db.sql("select to_regclass('public.social_post_gallery') is null")).toBe("t");
  expect(db.sql("select to_regprocedure('public.moderate_social_post_gallery_admin(uuid,uuid,uuid,integer,text,uuid[])') is null")).toBe("t");
  expect(db.sql("select count(*) from information_schema.columns where table_name='social_posts' and column_name='gallery_photos'")).toBe("0");
  db.applyFileTransactional(videoRollback);
}
