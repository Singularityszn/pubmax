# Social galleries and feed videos

Status: the 28-case browser pack passed on the feature source. A later review found one draft-clear defect.
The corrections passed 20 composer tests. The new IndexedDB browser regression remains pending.
The integration task owns the final combined repository gate and the new browser case on its production build.
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

The final 28-case browser run passed in 47.8 seconds, with one Chromium worker and no retries or tracing.
It covers upload retry, ordered publication, horizontal photo swipe, vertical video swipe, focus, access, drafts, and post actions.
Phone and desktop checks cover both themes, keyboard controls, overflow, and axe accessibility assertions.
The invite-clearance cases passed at 390 and 430 pixels.

The first run passed 24 cases. A later run passed 26 cases before two focused corrections passed.
The legacy photo fixture used a host outside the Content Security Policy. It now uses a same-origin image.
A cross-tab failure also remained in that run. Its exact trigger was not captured.
The focused rerun and final full pack passed with navigation and storage-key diagnostics enabled.
A separate rendered regression proved that same-account access revalidation unmounted the composer; that source defect is fixed.
The retained [browser event log](first-tab-events.json) includes development Fast Refresh events. It is not production evidence.

Source: `3e4d65c82`, plus the committed test corrections. Next.js 16.3.3, React 19.2.8, Playwright 1.62.1.
The worktree owns its dependencies. It does not link the root dependency directory.
TypeScript, ESLint, and Knip passed before the later draft-clear correction. ESLint reported 67 warnings and zero errors.

The later review found a stale photo-storage error after successful draft deletion.
The correction clears that error only after deletion succeeds. Failed deletion keeps posting blocked.
Rendered regressions failed before the corrections. All 20 composer tests passed afterward.
A refused gallery deletion now retains photos and caption, with a retry error. Text-only clear does not require photo storage.
TypeScript and scoped ESLint passed again on source `2b80dca70`.
The new real IndexedDB case covers quota refusal, deletion refusal, successful retry, and text-only publication.
It must run against the integrated production build before merge; the earlier 28-case pass does not cover these later corrections.
The test is `clearing a failed photo draft allows a text-only post` in `e2e/social-gallery.spec.ts`.

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
