# Social post media

This document describes the source upload contract. It does not confirm a production rollout.
The feature shares moments from real outings through one photo or short video per Social post.

## Upload and edits

`POST /api/social/posts` accepts `multipart/form-data` with one `post` JSON field and one attachment.
Use `photo` for an image or `video` for an MP4. Sending both files is invalid.
Use the signed-in account's bearer token and the existing `Idempotency-Key` header.
The server derives identity and checks Social access, audience, and moderation permissions.

Example `post` field for a video:

```json
{
  "kind": "standard",
  "visibility": "friends",
  "commentPolicy": "open",
  "body": "Outside the pub after the walk",
  "photoAltText": "Our group waves outside the pub",
  "tagHandles": []
}
```

`photoAltText` is the required media description for either file type. Video attachments do not accept photo tags.
The response retains the existing `post.photo` attachment slot:

```json
{
  "mediaId": "<uuid>",
  "altText": "Our group waves outside the pub",
  "kind": "video",
  "contentType": "video/mp4"
}
```

Missing `kind` and `contentType` mean a legacy photo. Render MP4 attachments as videos.

`PATCH /api/social/posts/{postId}` uses the same multipart fields to replace an attachment.
Include `expectedMutationVersion` in `post` and describe the replacement with `photoAltText`.
An attachment-only replacement is valid.
To remove either attachment type, send JSON with `expectedMutationVersion` and `removePhoto: true`.
Removal sends no file. Existing version conflicts, idempotency rules, and detached-object cleanup still apply.

## Release limits

`lib/socialMediaPolicy.ts` owns the shared constants and requirements label.

| Export | Limit |
| --- | --- |
| `SOCIAL_VIDEO_MAX_BYTES` | 4,194,304 bytes, displayed as 4 MB |
| `SOCIAL_MEDIA_BODY_MAX_BYTES` | File limit plus 65,536 bytes for multipart fields |
| `SOCIAL_VIDEO_MAX_SECONDS` | 15 seconds |
| `SOCIAL_VIDEO_MAX_DIMENSION` | 1920 pixels per side |
| `SOCIAL_VIDEO_ACCEPT` | `video/mp4` |
| `SOCIAL_VIDEO_REQUIREMENTS` | Shared user-facing requirements label |

Video requires a self-contained, non-fragmented MP4 with H.264 and optional AAC-LC audio.
The initial H.264 subset uses 8-bit 4:2:0 with Baseline, Main, Extended, or High profile.
Flexible macroblock ordering and in-band parameter-set replacement are unsupported.
SPS dimensions must match the container. Coded and cropped dimensions must stay within the cap.
Portrait 1080×1920 fits. Ordinary camera files can exceed the byte limit or use unsupported codecs, such as HEVC.

The server validates bounded container tables, sample ranges, parameter-set syntax, and leading slice references.
It removes identifying container metadata while preserving sample offsets. It does not decode or transcode video.
Staff must check native playback before approval. Header validation does not prove that every coded picture is valid.
Photos retain the existing image preparation pipeline and 1200-pixel output limit.

## Authorised playback and review

Request `GET /api/social/media/{mediaId}?format=json` with the viewer's bearer token.
`Accept: application/json` selects the same response: `{ "url", "kind", "contentType" }`.
All requests check the current audience and approved moderation state. Responses use `private, no-store`.

Durable storage returns a signed URL with a 180-second lifetime. Native image or video elements use that URL.
Without durable storage, JSON returns `/api/social/media/{mediaId}`, never inline base64.
The client fetches that path with bearer authentication and creates a revocable Blob URL.
This flow does not require a resume cookie.
The byte response supports range requests. Release Blob URLs when media leaves the active account's view.
Audience changes block new URL issuance; previously issued signed URLs can remain valid until expiry.

Videos enter the existing moderation queue and move to `needs_review`. They never enter the image moderation adapter.
The current queue cron requires the existing `OPENAI_API_KEY` configuration before it drains any jobs.
Keep the existing cron active. A pending or held video must not appear as published.

The staff queue carries `media.contentType` and plays videos through `/api/admin/social-posts/media/{mediaId}`.
That route requires the existing admin session. Approval stays disabled until the video loads and after playback errors.
Hide remains available when preview fails.

## Migration 0154 rollout

The owner applies `supabase/migrations/20260907160000_0154_social_video.sql` before enabling durable video uploads.
No production migration was applied as part of this implementation.
Photos continue through the existing reservation RPC before this migration.
Photo reads and admin review do not require the new `social_posts.photo_content_type` column.
Video uploads require the new `reserve_social_post_video_upload` RPC and fail before upload if it is absent.

The migration adds video type and duration constraints, derived post metadata, and the video reservation RPC.
It preserves private storage, photo constraints, atomic post writes, and consent boundaries.
It also permits foreign-key cleanup to clear a deleted media reference in the otherwise immutable moderation audit.
If the private bucket restricts MIME types, permit `video/mp4` before enabling uploads.
Use the existing storage vendor; this release adds no paid service.

Rollback file: `supabase/migrations/rollback/20260907160000_0154_social_video_rollback.sql`.
Rollback refuses while video media or upload rows remain.
Remove videos through the normal post lifecycle and run detached-media cleanup before rollback.
Do not remove video rows manually to bypass that guard.

## Focused evidence

`__tests__/socialVideo.test.ts` accepts real MP4 fixtures and rejects hostile mutations.
`__tests__/socialAvc.test.ts` checks parameter-set syntax, dimensions, references, and bounded reads.
`__tests__/socialVideoRoute.test.ts` covers upload, replay, held review, audience checks, authenticated bytes, replacement, and removal.
`__tests__/socialComposerMigration.test.ts` covers durable SQL constraints and rollback.
Fixture provenance and native playback evidence live beside `__tests__/fixtures/social-video.md`.
