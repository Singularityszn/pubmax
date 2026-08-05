# Task 6 report: composer, private media, and consent

## Status

Complete. Social remains behind existing preview and verified-adult access. No
migration was applied to a hosted database and no push was performed.

## Delivered

- Added mobile-first text and photo creation with area, exact friends-only
  Venue, visibility, hashtags, feature requests, alt text, and photo tags.
- Added strict bounded JSON and multipart parsing before image work. JPEG, PNG,
  and WebP input is normalised to bounded private JPEG media. Object paths omit
  profile, account, and handle identifiers.
- Added idempotent create and remove requests. Exact photo retries reuse one
  deterministic media identity. Changed retries return conflict without
  deleting a winning object.
- Added account-bound local text and IndexedDB photo drafts. Failed submissions
  keep the same request key. Account switches isolate drafts, and two open tabs
  warn through BroadcastChannel.
- Added explicit tag proposal, approval, decline, withdrawal, and cancellation.
  Identity projection re-checks current blocks. Consent events remain
  append-only after media cleanup.
- Added full compare-and-swap editing, immutable digest audit, edited markers,
  existing alt-text correction, photo replacement, and photo removal. Comment
  policy uses the same revision and audit owner.
- Added revision and media-bound moderation completion, named staff held review,
  owner outbox, signed delivery budgets, protected Venue lookup budgets, and a
  30-day detached-media cleanup in the scheduled moderation route.
- Migration 0074 refuses legacy non-null Task 3 photo references before making
  partial state. Rollback restores Task 3 rules and leaves profiles and blocks.

## Review fixes

Closed every Critical, Important, Minor, and missing-contract item in
`task-6-core-review.md`. Full-suite review also found two stale certification
fences: mutation inventory omitted tag and staff moderation routes, and cron
response proof omitted the cleanup count. Both now have direct tests.

## Verification

Focused TypeScript and Task 6 tests:

```sh
npm run typecheck
npx vitest run __tests__/socialComposerMigration.test.ts __tests__/socialPostSubmission.test.ts __tests__/socialPostStore.test.ts __tests__/socialPostsRoute.test.ts __tests__/socialInteractionsRoute.test.ts __tests__/socialPostMedia.test.ts __tests__/socialReadProtectionRoutes.test.ts __tests__/boundedRequest.test.ts __tests__/socialShellUi.test.ts --maxWorkers=1
```

Result: TypeScript passed. Nine files and 77 tests passed. The real PostgreSQL
migration suite contributed 9 passes for forward refusal, CAS races, tag consent,
moderation locks, idempotent removal, detached-media evidence preservation, and
rollback.

Mutation certification and scheduled cleanup:

```sh
npx vitest run __tests__/writeSurfaceCertification.test.ts --maxWorkers=1
npx vitest run __tests__/socialPostModerationRoute.test.ts --maxWorkers=1
```

Result: 7/7 and 4/4 passed.

Full unit suite:

```sh
npm test -- --maxWorkers=1
```

Result: 785 files and 7,893 tests passed in 285.14 seconds.

Production build:

```sh
NEXT_DIST_DIR=.next-task6 npm run build
```

Result: passed. Existing `lib/ogBrand.tsx` Edge-runtime warnings remain.

Production browser proof:

```sh
PW_SCREENSHOTS=1 PW_SOCIAL_COMPOSER_PROOF=1 PW_NEXT_DIST_DIR=.next-task6 npx playwright test e2e/social-composer.spec.ts --project=chromium
```

Result: 10/10 passed in 19.2 seconds. Coverage includes text and photo posting,
failed photo draft reload, stable retries, account-switch isolation, two-tab
warning, Venue selection, tag approval and withdrawal, alt-text correction,
photo removal, stale-edit recovery, edit reopen, focus containment, Escape focus
return, axe, no horizontal overflow, light and dark themes, and 320, 390, 430,
and 1280 px widths.

## Proof

Screenshots and command index: `docs/proof/social-composer/README.md`.

## Concerns

- Captain must apply migration 0074 after migrations 0072 and 0073.
- Social beta remains off until release owners assign moderation providers and
  approve access policy.
- Detached photo deletion depends on the existing scheduled moderation route.
