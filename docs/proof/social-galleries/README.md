# Social galleries and feed videos

Status: local implementation. Initial browser checks passed 24 of 28 cases.
Four cases need correction and a repeat check. Full repository checks are pending.
Branch: `codex/social-galleries`, after the preserved `a400d383f` release.
No production migration or deployment ran.

## Changes

- Choose up to ten photos. Reorder, remove, and describe each photo.
- Prepare phone photos as JPEG, without cropping. Strip metadata before upload.
- Upload each photo separately. Publish the ordered gallery in one database transaction.
- Keep local originals, upload keys, and completed uploads through retries and reloads.
- Keep Friends as the initial audience. Retain existing photos during gallery edits.
- View photos with horizontal swipe, arrow buttons, and keyboard controls.
- Open current feed videos in a full-screen viewer. Vertical navigation pauses the previous player.
- Preview every gallery photo before staff approval. Keep review decisions tied to the current revision.
- Keep the invite action clear of the floating Create button through the existing layout rule.

## Verification

Focused checks cover these boundaries:

- Ownership, upload expiry, duplicate attachments, ordering, removal, and request replay.
- Stale edits, audience changes during reads, and object cleanup during concurrent edits.
- Every-photo moderation, provider failures, invalid manifests, and expired review leases.
- Independent create and edit request keys in both storage backends.
- Composer draft isolation, photo preparation, retry controls, keyboard operation, and admin previews.
- Real PostgreSQL migration, row access, and rollback checks through the existing composer test cluster.

The final migration check passed 27 tests across two suites, including the older admin-client guard.
Command: `npx vitest run __tests__/socialComposerMigration.test.ts __tests__/migrationVersions.test.ts --maxWorkers=1`.
The temporary PostgreSQL cluster stopped after the check.

The first browser run passed gallery upload retry, ordered publication, keyboard controls, phone swipe, and both themes.
It also passed discovery, playback visibility, post interactions, and four invite-clearance cases.
The remaining cases cover cross-tab drafts, restored legacy previews, video order, and signed-out access.

The browser pack uses local API fixtures. Database authority is tested separately with real PostgreSQL.
Screenshots use existing project photographs and a local video fixture. They are not published user posts.

## Release requirements

Apply `20260908010000_0155_social_galleries.sql` before deploying this gallery release.
Migration application remains a separate owner action.
The migration requires a matching gallery manifest lease before a worker can approve a gallery.
An older worker cannot approve ten photos after checking only the first photo.
Staff approval must send every current media ID in display order. Older admin clients cannot approve galleries.

The earlier `codex/social-real-life` branch remains available at `a400d383f`.
That earlier release requires migration `0154` for its short-video feature, but does not require `0155`.

Video ingestion still accepts H.264 MP4, up to 15 seconds and 4 MiB.
Larger phone videos and HEVC need direct uploads and asynchronous processing.
The [video upload comparison](../../social/VIDEO_INGEST_OPTIONS.md) describes that next step and its current primary sources.
No video provider was selected or provisioned.

Native device gallery and video proof remains separate from desktop browser emulation.
The messaging recipient-entry change belongs to the separate messaging task.

See the [gallery contract](../../social/SOCIAL_GALLERY_CONTRACT.md) and [invite clearance proof](../social-invite-clearance/README.md).
