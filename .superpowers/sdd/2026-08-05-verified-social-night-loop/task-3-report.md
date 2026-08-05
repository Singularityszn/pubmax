# Task 3 report: verified Social posts

Status: review round 1 complete. Original implementation is commit
`2ead21b38`; fixes are in the repository commit containing this report update.

## Delivered

- Added strict Social post domain validation for standard and feature-request
  posts, public/friends/private visibility, listed areas, hashtags, comments,
  future owned-photo references and recoverable removal.
- Extended verified Social access with a server-only actor containing product
  account ID, stable profile ID and current handle. Client input cannot supply
  ownership, moderation, revision, timestamp or storage fields.
- Added keyless in-memory and durable Supabase stores. Production selects the
  durable store and fails closed when configuration or migration state is
  unavailable.
- Added verified GET/POST/PATCH routes at `/api/social/posts` and
  `/api/social/posts/[postId]`, with private no-store responses, stable-profile
  rate-limit keys and strict UUID item paths.
- Added discover, nearby and following feeds. Following contains public posts
  from followees and friends posts from mutual followees only. Direct private
  reads remain author-only. Every read also requires visible status and an
  approved moderation decision.
- Added newest-first `(created_at, id)` keyset pagination with default 20,
  maximum 50 and viewer-bound HMAC cursors. Cursor payloads contain no viewer,
  account or profile ID.
- Added direct OpenAI Moderations API integration using exact model
  `omni-moderation-latest`.
- Added durable pending moderation jobs, leased batch claims, bounded
  exponential retry for 408, 429, network and 5xx failures, held terminal error
  state for authentication or malformed responses, and revision checks that
  prevent an old in-flight result from approving newer text.
- Added protected cron worker at `/api/cron/moderate-social-posts` and Vercel
  minute schedule. No request write starts background work.
- Added migration `0072` plus rollback. Tables and functions are service-role
  only with RLS enabled and no browser policies.
- Updated privacy, terms and write-surface certification. Disclosure names
  OpenAI, held moderation, text sent today and future photos sent when
  ownership-checked photo posting opens.

Photo upload itself remains closed by design for Task 3. Photo-bearing create
or edit requests return `PHOTO_UPLOAD_NOT_AVAILABLE` until the later ownership
and upload task ships.

## Review round 1 fixes

All seven review findings are closed:

- Durable edits now use a transactional revision compare-and-swap RPC. A real
  PostgreSQL concurrency test proves one of two same-revision edits wins and
  only its exact revision and moderation claim are queued.
- Create, edit and recoverable removal call the Social freeze guard before
  identity, limiter or storage work.
- Moderation receives one canonical claim made from body plus normalised
  hashtags. Durable jobs preserve that exact text.
- Create, edit, removal and feed limit keys use the shared salted actor digest.
  Raw stable profile IDs never enter the limiter key.
- OpenAI moderation has a 10-second abort timeout. Leased batch items run in
  isolated concurrent promises, so one held or failed request cannot block the
  rest of the batch.
- Worker results count terminal errors. Held posts remain pending and cannot be
  read. Authenticated cron action `?action=requeue-terminal` can requeue a
  bounded terminal batch after configuration repair and never auto-approves it.
  Metadata-only edits preserve terminal state and active leases. Completion
  persistence failures finish unaffected batch items, then fail the drain
  instead of returning a false `ok` result.
- Feed GET requests have a 60-per-minute budget partitioned by actor digest,
  lane and nearby area.

## TDD and self-review evidence

Red evidence captured before each implementation seam:

- Missing domain/store modules failed their suites.
- Verified actor tests failed until stable profile ownership was resolved on
  the server.
- Route, OpenAI adapter, cron and migration tests failed while their modules or
  schema were absent.
- Legal and write-surface tests failed before disclosure and certification.
- Hardening tests exposed non-retryable hot-loop behavior, permissive
  production backend selection, unlisted nearby areas, missing rate limits,
  unchanged-edit revision churn and stale moderation completion races.
- Cursor inspection exposed unsigned viewer scope data.
- Self-review regression tests exposed own-private posts in Following and
  non-UUID paths reaching durable storage.

Each review finding received a failing regression test before its implementation
change. Final review-round focused result:

```text
Test Files  9 passed (9)
Tests       50 passed (50)
Duration    35.75s
```

This includes a real local PostgreSQL 16 run that applies migration `0072`,
exercises constraints, durable job revision races, all feed visibility lanes,
service-only grants, then applies rollback and proves profile/follow state is
untouched.

Review-round verification:

- Real PostgreSQL migration and concurrency proof: 4 passed.
- `npm run typecheck`: exit 0.
- Changed-file ESLint: exit 0 with no output.
- Full `npm run lint`: exit 0, 0 errors and 29 pre-existing warnings.
- `git diff --check`: exit 0 before commit.

One full single-worker repository run completed with 768 of 769 files and 7,772
of 7,774 tests passing. Both failures were unrelated 20-second subprocess
timeouts in `validateDrinkPriceUpdatesScript.test.ts` during concurrent
repository coverage load. Their exact isolated rerun passed 2 of 2 in 14.03s.
Every Task 3 suite passed inside the full run.

## Deployment note

Captain must apply `supabase/migrations/20260805110000_0072_social_posts.sql`.
Agents shipped SQL only. Rollback is
`supabase/migrations/rollback/20260805110000_0072_social_posts_rollback.sql`.
