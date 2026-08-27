# PUBMAXX Complete Feature Execution Plan

> **For agentic workers:** Execute one owned slice at a time. Use TDD for code
> changes. Do not deploy or build store artefacts before shared release gate.

**Goal:** Finish every current and planned PUBMAXX work package without losing
dirty work, reviving rejected plans, creating overlapping owners, or deploying a
partial product.

**Architecture:** Keep one Next.js product, one London v0 integration lane, and
one Capacitor native lane. Use the coordination lane as dependency and evidence
owner. Post-v0 features remain assigned and sequenced, but do not edit shared
London files until London v0 acceptance fixes the source baseline.

**Authority:** `CONTEXT.md`, `docs/CURRENT_CONTEXT_2026-08-27.md`,
`docs/superpowers/plans/2026-08-27-v0-release-reconciliation.md`, and
`fablenextsteps.md`. Historical and superseded Markdown is evidence only.

**State ledger:** `.cursor/complete-everything-state.md`.

## Task 1: Stabilise London v0 source and live supply

**Owner:** `Review and merge GitHub changes`

**Worktree:** `/Users/karanmanoharan/Documents/pubmax-review-20260827`

**Branch:** `codex/v0-recovery`

**Primary files:**

- `app/api/cron/refresh-whats-on/route.ts`
- `app/api/whats-on/route.ts`
- `app/api/out/route.ts`
- `app/out/**`
- `app/tonight/**`
- `lib/whatsOn*.ts`
- `lib/out/**`
- `supabase/migrations/20260824120000_0119_whats_on_listings.sql`
- `supabase/migrations/20260827100000_0120_social_connection_lifecycle.sql`
- `supabase/migrations/20260827110000_0121_wanted_public_list_promotion.sql`
- `supabase/migrations/20260827120000_0122_wanted_promotion_already_saved_fix.sql`

- [ ] Record current remote migration ledger and affected table state.
- [ ] Confirm migrations 0119-0122 occur once and in order.
- [ ] Verify RLS, grants, RPC results, and security advisors.
- [ ] Run bounded authorised What's On refresh.
- [ ] Record fetched, date-valid, London-valid, Venue-matched, unmatched, stored,
  and served counts by provider.
- [ ] Keep unmatched inventory out of primary pub recommendations.
- [ ] Prove source, observation time, Venue, and booking destination.
- [ ] Fix any honest-empty, freshness, or attribution defect through TDD.

Verification:

```sh
npm test -- __tests__/cronRefreshWhatsOnRoute.test.ts \
  __tests__/whatsOn*.test.ts __tests__/out*.test.ts \
  __tests__/tonight*.test.ts
npm run typecheck
npm run lint
git diff --check
```

Done when durable current matched London Venue supply is non-zero or provider
empty state is proved honest, and no required freshness result is unresolved.

## Task 2: Certify complete London customer loop

**Owner:** `Review and merge GitHub changes`

**Primary files:**

- `components/plan/**`
- `app/api/plans/**`
- `app/invite/[token]/**`
- `lib/planStore.ts`
- `lib/planCollaborationStore.ts`
- `components/map/VenuePriceSubmit.tsx`
- `app/api/pint-drops/**`
- `app/api/price-submit/**`
- `lib/communityPrice*.ts`
- `components/map/communityPriceSignals.ts`

- [ ] Prove guest Plan creation, editing, and review.
- [ ] Prove signup atomically claims the same Plan.
- [ ] Prove WhatsApp, copied link, private invite, and Open Crew converge on one
  canonical membership.
- [ ] Prove host and guest complete one Planned Night in two browsers.
- [ ] Record final Crawl Stop and Crawl Ending exactly once.
- [ ] Prove recap and Plan again.
- [ ] Create one real signed-in Pint Drop without creating a Visit Report.
- [ ] Prove first fresh price report adds only provisional mark.
- [ ] Prove second independent fresh report can gain Map authority.
- [ ] Prove report, moderation hide, and restore paths.

Verification:

```sh
npx playwright test e2e/plan-invite.spec.ts --workers=1
npx playwright test e2e/plan-loop.spec.ts --workers=1
npx playwright test e2e/crews-and-people.spec.ts --workers=1
npx playwright test e2e/price-submission.spec.ts --workers=1
npm test -- __tests__/communityPrice*.test.ts \
  __tests__/plan*.test.ts __tests__/pintDrop*.test.ts
```

Done when one consented real two-person Planned Night completes and one durable
Pint Drop enters trust loop without privacy or authority breach.

## Task 3: Complete London data lane

**Owner:** London data lane with coordination handling credentials and source
policy.

**Primary files and data:**

- `/Users/karanmanoharan/.treehouse/pubmax-bde241/3/pubmax`
- `public/data/uk_base/**`
- `public/data/drink_price_updates/**`
- `data/freshness_registry.json`
- `scripts/whatson/**`

- [ ] Rotate exposed Exa key outside chat and store only in protected key file.
- [ ] Run one low-cost Exa API canary. Do not infer API credit from Websets.
- [ ] Preserve seed, shard, and progress checksums.
- [ ] Verify no second harvest process exists.
- [ ] Resume from 2,000 durable bar rows only after canary passes.
- [ ] Produce atomic 500-row shards and final partial shard.
- [ ] Sample by source type and town before fold.
- [ ] Reject namesakes, duplicates, non-HTTPS citations, guessed facts, and
  missing timestamps.
- [ ] Preserve 38,215 unpriced pubs in viewport-streamed UK base layer.
- [ ] Collect launch price target and Venue essentials from real sources.

Done when output is source-grounded, checksummed, deduplicated, and safe to fold.
Exa `402` remains a human gate, not a silent provider substitution.

## Task 4: Close PR and release evidence

**Owner:** `Review and merge GitHub changes`

**Current PR:** #1237, `Recover London v0 discovery and activation`.

- [ ] Finish current Map navigation files without native overlap.
- [ ] Resolve PR findings and rerun focused tests.
- [ ] Run data validation, lint, typecheck, coverage, and isolated build serially.
- [ ] Run 320, 390, and 430 mobile geometry checks.
- [ ] Run 390x844 and 1440x900 light/dark browser matrix.
- [ ] Prove keyboard, touch, Back, Escape, focus return, target size, overflow,
  and screen-reader names.
- [ ] Merge only accepted source to GitHub `main`.
- [ ] Send exact merge SHA to native task.
- [ ] Do not deploy yet.

Verification:

```sh
npm run validate-data
npm run lint
npm run typecheck
npm run coverage
NEXT_DIST_DIR=.next-prod npm run build
git diff --check
```

## Task 5: Finish native readiness without product fork

**Owner:** `Build iOS Android mobile apps`

**Worktree:** `/Users/karanmanoharan/Documents/pubmax-mobile-release`

**Branch:** `codex/mobile-release-readiness`

**Owned files:** `capacitor.config.ts`, `ios/**`, `android/**`, `native/**`,
`lib/native*.ts`, `components/native/**`, native tests, assets, and proof docs.

- [x] Align iOS Capacitor package in `130d332d5`.
- [x] Declare foreground location access in `9e4f4df45`.
- [x] Use canonical install name in `f4af5606a`.
- [ ] Finish interrupted lint and typecheck closeout with memory check first.
- [ ] Capture browser-equivalent native proxy proof.
- [ ] Compile iOS Simulator and Android debug shells when local toolchains exist.
- [ ] Wait for London merge SHA, inspect overlap, then rebase on `origin/main`.
- [ ] Repeat Capacitor sync, doctor, tests, and metadata validation.
- [ ] At shared checkpoint, apply real signing identifiers and verify physical
  device camera, location, links, push, resume, offline, and deletion.
- [ ] Build signed archive and bundle only after shared checkpoint.
- [ ] Upload internal tests and complete store forms only with owner enrolment.

Verification:

```sh
npx cap sync
npx cap doctor
npm test -- __tests__/nativeWrap.test.ts \
  __tests__/nativeDeepLinks.test.ts __tests__/nativeFirstRun.test.ts \
  __tests__/nativePlatform.test.ts __tests__/nativePush.test.ts \
  __tests__/nativePushPrompt.test.ts __tests__/nativeSystemBars.test.ts \
  __tests__/storeAssets.test.ts
npm run typecheck
npm run lint
git diff --check
```

## Task 6: Clear human activation gates

**Owner:** Coordination task and Captain.

- [ ] Resolve GitHub Actions billing or runner allocation and rerun every
  protected check without admin bypass.
- [ ] Configure PostHog project access and certify closed property schemas.
- [ ] Prove consent denial sends no analytics and exclude staff/test accounts.
- [ ] Verify Search Console and Bing ownership, sitemap, and canonical host.
- [ ] Run five Londoner, five tourist, and five organiser sessions.
- [ ] Pilot five creators and five to ten Venues with tracked evidence.
- [ ] Record one weekly data story and one action from funnel review.
- [ ] Keep production deploy approval with Captain until release proof is ready.

## Task 7: Shared build and deployment checkpoint

**Owners:** London, native, and coordination tasks.

- [ ] Exchange exact commit SHAs, changed-file lists, tests, builds, proof, and
  unresolved blockers.
- [ ] Confirm release set has zero open PRs.
- [ ] Confirm production schema and current data supply.
- [ ] Confirm London and native shell accept same GitHub `main` commit.
- [ ] Build and deploy Vercel project `pubmax69/chengdu` only now.
- [ ] Verify `/api/version`, aliases, authentication boundaries, APIs, crons,
  runtime data files, logs, exceptions, funnels, and Web Vitals.
- [ ] Hold 24-hour canary.
- [ ] Roll back on critical journey, schema, privacy, or data-integrity failure.

## Task 8: Execute post-v0 product queue in dependency order

**Start condition:** Task 7 passes. These features are assigned now so none is
lost, but no task may modify conflicting London v0 files early.

1. Pub Pal task closes issue #282 with push-to-talk grants, privacy, quota,
   fallback, confirmations, and trace evidence.
2. London Social lane resolves issues #1182 and #1183, certifies moderation,
   privacy, provider OAuth, launch nav, and controlled cohort.
3. Web/Social slice builds messaging share, polls, Plan threads, and WhatsApp
   continuation.
4. Account slice builds privacy toggle and approved profile shape.
5. Account slice builds public activity history and honest `/add` promise.
6. Operator slice builds Venue operator channel under accepted ADRs.
7. London discovery slice builds Sunny Venue forecast with source uncertainty.
8. City slices close issue #287 with nine-city complete-night parity.
9. Product slices close issue #252 through independently measurable The Local
   releases.
10. Refactor slice closes issue #727 only where stores have identical policy and
    semantics.

Each slice requires a bounded spec, owned files, failing test first, rollout
flag where behaviour is risky, rollback path, browser proof, and measurable
acceptance evidence.

## Task 9: Safe memory and storage cleanup

**Owner:** Coordination task.

- [ ] Recheck RAM pressure and disk before every heavy wave.
- [ ] Classify every dirty primary path.
- [ ] Prove each old worktree's unique commits are merged or superseded.
- [ ] Record untracked environmental links separately from product work.
- [ ] Measure `.next*`, Playwright, browser, screenshot, and dependency caches.
- [ ] Remove generated caches only when no active task uses them.
- [ ] Remove worktrees only after exact branch recovery path is recorded.
- [ ] Delete branch refs only with separate Captain approval.
- [ ] Report reclaimed disk and remaining free space.

No source file, branch, or worktree is removed merely because GitHub has a newer
copy. Patch-equivalence and uncommitted work must be proved first.
