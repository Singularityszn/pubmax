# PubMaxxing V1 release handoff

Date: 5 August 2026  
Branch: `codex/v1-release-20260805`  
Pull request: [#726](https://github.com/Singularityszn/pubmax/pull/726)

## Release intent

Wave 0 closes public-release risks found in the 5 August product, mobile, trust,
and security review. It does not replace Fable's product work. Changes are
isolated on the V1 release branch and limited to release safety, honest product
claims, and mobile paths blocked by shipped chrome.

## Included

### Trust and product truth

- Night Crawl restores the previous cursor and optimistic state when a save is
  rejected or the network fails. Success state appears only after confirmation.
- Drink price presentation distinguishes baseline dataset values from dated
  update observations. Freshness budgets and London-local dates come from shared
  helpers.
- Demo-off mode removes demo prices and overlays through one shared classifier.
- Profile reaction summaries use bounded batches, abort cleanly, and fail soft.

### Mobile release path

- Venue tabs keep Last train reachable at 320, 390, and 430 pixel widths.
- Today removes duplicate safe-area and bottom-space ownership.
- Android install UI is a compact, non-modal card. It stays below 30 percent of
  a 320 pixel viewport with large text while leaving the map interactive.
- The native install event is captured before the lazy prompt mounts, retained
  in a shared store, consumed once, and cleared after installation.
- iOS keeps the instruction sheet because its install flow is manual.

### Security and identity

- Migration `20260805070000_0070_v1_release_security.sql` denies browser DML on
  eight Night Memory and voice tables while retaining the service-role path.
- The same migration moves Wave 2 SECURITY DEFINER policy helpers into the
  unexposed `pubmax_private` schema. Existing policy dependencies and function
  OIDs are preserved. Public PostgREST RPC discovery no longer exposes them.
- Voice token quota is reserved before provider allocation and compensated once
  on provider failure.
- Reserved profile handles are rejected consistently for anonymous and signed-in
  routes, including deletion paths.
- Clerk UI requires both Clerk keys and an established PUBMAXX product session.
  Account controls remain contained in the existing compact navigation popover.
- RLS session fixtures now model PostgREST 14 JSON JWT claims while retaining the
  legacy fallback used by older local environments.

## Verification completed

- `NEXT_DIST_DIR=.next-prod npm run ci`
  - data validation passed
  - lint passed with 29 pre-existing warnings and zero errors
  - TypeScript passed
  - Vitest coverage gate passed after aligning the legacy drink expectation with
    the new `lane: "dataset"` contract
  - resilient audit passed
  - Next production build completed across 466 static pages
- `npm run test:rls`: 61 assertions passed against PostgreSQL 16.14 and
  PostgREST 14.16, including migration, public RPC denial, JSON-claim access,
  service-role access, and exact rollback.
- Mobile V1 Playwright matrix: 14 tests passed across 320, 390, and 430 pixel
  phone viewports plus desktop coverage.
- Independent agent review completed for trust, security, and mobile lanes. All
  Critical and Important findings were fixed before integration.

Known build warnings: four existing Edge-runtime warnings in `lib/ogBrand.tsx`
for Node font-file access. Build succeeds. This wave does not change that path.

## Production gate owned by Captain

Do not promote this branch to production until Captain applies migration
`20260805070000_0070_v1_release_security.sql` to Supabase project
`iankajxliutqogqkmvdg`.

Current production migration history stops at `0069`. Agents must ship and test
SQL only. After Captain applies `0070`, release operator must confirm:

1. Migration appears in production history.
2. Supabase security advisor no longer reports public exposure of the eight
   `rls_*` helpers.
3. Preview smoke tests pass for authentication, map, Today, Tonight, profile,
   Night Crawl, voice-token denial, and Android install-card behaviour.
4. Pull request checks are green before merge and Vercel production promotion.

## Follow-up, not a V1 promotion blocker

- Production feeds `price_updates`, `weather`, and `whats_on` currently report
  stale. Existing issue [#635](https://github.com/Singularityszn/pubmax/issues/635)
  tracks scheduler repair. Surfaces already disclose degraded freshness rather
  than presenting stale material as current.
- Supabase leaked-password protection becomes mandatory if password sign-in is
  introduced. Current shipped auth uses magic-link OTP and OAuth, not password
  authentication.
- Physical Android native install chooser remains device-only QA. Browser tests
  cover prompt retention, card geometry, focus, persistence, and install event
  cleanup.

## Rollback

- App: redeploy the last known-good Vercel production deployment.
- Database: use
  `supabase/migrations/rollback/20260805070000_v1_release_security_rollback.sql`.
  The tested rollback restores the pre-wave function schema, policy catalogue,
  and privilege catalogue without `CASCADE`.
