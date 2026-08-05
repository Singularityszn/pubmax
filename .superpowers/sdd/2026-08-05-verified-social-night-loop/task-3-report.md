# Task 3 report: verified Social posts

Status: complete in commit `2ead21b38`.

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

Each red test turned green after the narrow implementation change. Final
focused result:

```text
Test Files  8 passed (8)
Tests       66 passed (66)
Duration    8.28s
```

This includes a real local PostgreSQL 16 run that applies migration `0072`,
exercises constraints, durable job revision races, all feed visibility lanes,
service-only grants, then applies rollback and proves profile/follow state is
untouched.

Additional verification:

- `__tests__/writeSurfaceCertification.test.ts`: 6 passed.
- `npm run typecheck`: exit 0 after final self-review changes.
- Changed-file ESLint: exit 0 with no output.
- Full `npm run lint`: exit 0, 0 errors and 29 pre-existing warnings.
- `git diff --check`: exit 0 before commit.

One full repository test run completed with 761 files and 7,705 tests passing,
plus 25 failures across 8 unrelated files. Failures were setup and 20-second
timeouts under load in existing validation, plan, UK-base, tracing, postcode,
ESLint-scope and RLS suites. All Task 3 suites passed inside that run. Per
coordination instruction, no duplicate full-suite run was launched; the final
single-worker Task 3 run above is authoritative for this slice.

## Deployment note

Captain must apply `supabase/migrations/20260805110000_0072_social_posts.sql`.
Agents shipped SQL only. Rollback is
`supabase/migrations/rollback/20260805110000_0072_social_posts_rollback.sql`.
