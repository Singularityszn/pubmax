# Social gallery contract

The moderation cron allows 180 seconds for up to ten sequential image checks and database completion.
Each provider request has the existing ten-second timeout. Image links are signed immediately before each check.
The database lease lasts five minutes. [Vercel duration configuration](https://vercel.com/docs/functions/configuring-functions/duration) controls the runtime ceiling.

This release requires its gallery migration before deployment. The previous `a400d383f` release does not require it.
Migration `20260908010000_0155_social_galleries.sql` owns this contract. Missing RPCs must fail closed, including during schema-cache refresh.

## Upload

`POST /api/social/uploads/photos` accepts one multipart `photo` and an `Idempotency-Key`.
The server verifies the actor, prepares the photo, reserves its private object, uploads it, and marks it ready.
The response contains `{mediaId}` only. Clients cannot submit object keys, generations, or actor identifiers.
An existing attached media ID cannot be reserved again.

```sql
mark_social_gallery_upload_ready(
  p_owner_profile_id uuid, p_media_id uuid, p_generation uuid
) returns boolean

read_social_gallery_uploads(
  p_owner_profile_id uuid, p_media_ids uuid[]
) returns table (
  media_id uuid, generation uuid, object_key text, sha256 text,
  width integer, height integer, byte_size integer, content_type text
)
```

Both RPCs require the service role. Reservations remain `staged`; nullable `uploaded_at` records readiness.
Readiness and commit require `created_at` within 24 hours. Marking readiness does not extend that lifetime. Re-reserving an expired ID also fails.
Cleanup-state, expired, missing, foreign, and non-JPEG reservations cannot commit.
Lookup returns trusted metadata in request order. Commit independently checks and locks every item.

## Commit

```sql
create_social_post_gallery_idempotent(
  p_actor uuid, p_payload jsonb, p_idempotency_key text, p_request_digest text
) returns setof public.social_posts

edit_social_post_gallery_idempotent(
  p_actor uuid, p_payload jsonb, p_idempotency_key text, p_request_digest text
) returns setof public.social_posts
```

The create payload contains normalized `kind`, `visibility`, `body`, `area`, `venueId`, `hashtags`, `commentPolicy`, and `gallery`.
The edit payload also requires `postId` and `expectedMutationVersion`. Absent ordinary edit fields retain their current values.
Explicit null clears `area` or `venueId`. `gallery` always describes the entire desired ordered list.

```json
{
  "gallery": [
    { "mediaId": "<uuid>", "altText": "Friends outside the pub" },
    { "mediaId": "<uuid>", "altText": "The group beside the river" }
  ]
}
```

Create accepts 1-10 photos. Edit accepts 0-10 photos, including retained photos from that same post.
An empty edit gallery explicitly removes all photos. Every description must contain 1-300 characters.
Duplicate media IDs and gallery tags are invalid. Existing single-photo tag paths remain available.

The server fingerprint includes all normalized fields and every ordered media ID and description.
SQL also records a payload fingerprint and rejects changed payloads under an existing request key.
Replay checks precede reservation consumption. Post writes, reservation consumption, ordering, and primary mirroring form one transaction.
The server derives the current handle and storage metadata. Clients supply neither.

`social_post_gallery` is canonical. Its positions are 1-based, and each media ID belongs to at most one gallery.
`social_posts.gallery_photos` is derived JSON: ordered `{mediaId,altText}` objects.
`NULL` identifies a legacy post; `[]` identifies an explicitly empty gallery.
Position 1 also sets the existing `photo_media_id` and `photo_alt_text` fields.
Existing `select *` readers receive this optional projection without per-post lookups.

Gallery edits share the existing SQL edit core. Each mutation creates one audit entry and increments its version once.
Reordering retains media. Removed media enters the existing 30-day detached-media lifecycle.
Legacy edits cannot replace a gallery primary independently. Whole-post removal clears the entire gallery.

## Moderation and serving

```sql
read_social_gallery_moderation_manifest(
  p_post_id uuid, p_revision integer, p_lease_token uuid
) returns jsonb
```

This service-only RPC checks the current processing job, content revision, and lease.
It returns `NULL` for an invalid lease. Valid results have this shape:

```json
{
  "gallery": true,
  "items": [
    { "mediaId": "<uuid>", "objectKey": "<private key>", "altText": "Friends outside", "position": 1 }
  ]
}
```

`gallery: false` permits the existing primary-media or text-only path. It also covers an explicitly empty gallery. It is an explicit answer, never a missing-RPC fallback.
For nonempty galleries, the processor must scan every current item before returning an aggregate verdict.
An incomplete manifest or failed read must not approve the primary alone.
A valid manifest read records its lease on the moderation job. Nonempty gallery completion requires that recorded lease.
This blocks older processors that scan only the primary photo. It does not prove that a processor performed its scans.
The database applies completion under the matching revision and lease, then propagates the verdict to every current item.
Explicitly empty galleries have no photo to scan; their text still follows the existing moderation path.

Public media serving uses the same post audience, moderation, and block checks for every gallery item.
Admin media serving requires the same current held post and active staff role.
Staff review remains a whole-post action with the expected revision. The UI must load every preview before enabling approval.

```sql
moderate_social_post_gallery_admin(
  p_staff_role_id uuid, p_post_id uuid, p_media_id uuid,
  p_expected_revision integer, p_action text, p_reviewed_media_ids uuid[]
) returns boolean
```

This RPC requires the service role. Gallery approval requires every current media ID in canonical order.
Null, partial, stale, or reordered ID arrays return false. The expected revision must also match.
The existing five-argument `moderate_social_post_admin` delegates with a null ID array.
Older staff clients can hide galleries but cannot approve them. Legacy media and explicitly empty galleries retain existing approval behaviour.
All objects remain in the existing private bucket.

## Rollout and rollback

Apply the confirmed migration before deploying this gallery release. Do not bypass missing moderation RPCs on `PGRST202`.
Keep the previous release available for rollback until gallery-specific data can be removed safely.
The matching `20260908010000_0155_social_galleries_rollback.sql` refuses while nonempty gallery relations remain.
Use normal post removal and detached-media cleanup before removing gallery schema.
