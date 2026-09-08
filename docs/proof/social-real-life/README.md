# Social: real-life experiences

Karan's direction, 7 September 2026: people share photos and videos about enjoying life.
The first focus is real-life experiences, discovery, and making plans together.
Karan authorised implementation and parallel workers while optional product questions remain open.

## This change

- Open Social on discovery, with explicit Following and Nearby feeds.
- Require an area choice before a Nearby request. Do not request device location.
- Show the feed before account and community controls on phones.
- Put media before captions and link each author to their profile.
- Simplify the composer while retaining drafts, audience choices, and moderation.
- Add bounded MP4 uploads through the existing account and audience controls.
- Connect post interactions to the existing API.
- Keep video approval unavailable until the moderator can load the current clip.
- Stop stale edit drafts from replacing newer audience settings.
- Keep open drafts stable when another tab starts or saves a draft.

## Decisions

Friends remains the initial publishing audience. Choosing discovery does not change any post's audience.
Exact venue details retain their existing audience projection.
Pub Pal remains a personal helper. This change grants no agent publishing or invitation authority.

## Ownership

The isolated branch is `codex/social-real-life`, based on `30a8b98fe`.
Workers own media, composer, and post interactions. The parent owns discovery and integration.
The separate app audit owns shared authentication and arrival fixes.

## Validation

`npm run verify` exited successfully on 7 September 2026.
The final run passed 16,459 tests, with one existing skipped test.
The real PostgreSQL policy suite passed all 373 tests across 32 suites.
Data validation, lint, type checking, dead-code checks, browser-skip checks, freshness, and dependency audit also passed.
Lint reported 69 existing warnings and no errors. The audit found no high or critical vulnerabilities.
Three durable feed ages need credentials and remain explicitly unmeasured.

Browser tests use local fixture accounts and stubbed API responses. They do not publish real posts.
Backend tests separately exercise validation, storage, and access rules.

The discovery and interaction browser suite passed all five cases:

```
PW_SKIP_WEBSERVER=1 PW_PORT=3460 npx playwright test e2e/social-discovery.spec.ts e2e/social-post-actions.spec.ts --project=chromium --workers=1
```

These cases cover feed navigation, explicit area selection, light and dark accessibility, video playback, offscreen pause, Cheer, comments, and reporting.
They also check that distant posts do not load interaction summaries.

All 15 composer browser cases also passed, including four widths in both themes.
The final two cases passed after identity fixes, with the original second-tab startup order restored.
The first tab keeps its open draft while the second tab starts, edits, and clears its own view.
Video proof checks native decoding, the selected file bytes before fetch, multipart fields, authentication, and the held-review receipt.
Chromium's intercepted request body omits file bytes. The test records those bytes before forwarding the unchanged request.

The identity fix filters unrelated storage events and suppresses notifications for an unchanged canonical handle.
Its 70 focused identity and cache tests pass. Seven integration suites also pass all 97 tests.
The shared fix is commit `a4a53c69b`. The app audit has received it separately from the Social feature.
An independent review ran 18 video probes. Real clips pass; malformed headers, parameter sets, offsets, and dimensions fail.

Screenshots show fixture posts, not customer activity:

- [Phone feed](screenshots/social-phone.png)
- [Desktop light](screenshots/social-desktop-light.png)
- [Desktop dark](screenshots/social-desktop-dark.png)

## Rollout

Video supports H.264 MP4 with optional AAC-LC audio, up to 15 seconds and 4 MiB.
Each side must be at most 1920 pixels. This release does not transcode clips.
All uploaded videos require moderator review before readers can view them.

Apply migration `20260907160000_0154_social_video.sql` before enabling video uploads in production.
Photo writes remain compatible with the earlier schema.
The rollback refuses to run while video records remain. Complete the existing media cleanup first.
No database migration or deployment was performed during this work.
