# Store backend inventory

Companion to issue #727, "Spec: reduce store/review bloat without hiding
policy". This file is the review artefact for every `lib/*Store.ts` module.
The inventory is descriptive, not a runtime registry.

## Current snapshot

Source baseline: audit integration `7d393b87c45dfbd4662d22cb5c27b90051f51505` and Social `786a5672b83414bb47a9cda5baacbb4230cdc72b`, plus this #727 candidate.
Counts below use `lib/*Store.ts`; the broader source fixture also includes `*Store*.ts`.
The source includes the Messages production boundary and Social gallery/media changes.
This inventory records source policy, not a passed integration gate or production rollout.

- The repository has 53 `lib/*Store.ts` modules.
- 39 modules contain a direct `selectStore(...)` call.
- 8 modules use `createDualBackendStore`.
- 6 modules keep memory state on `globalThis` so it survives a development
  server reload. That state pattern is separate from backend selection.
- The remaining modules use an explicit backend, a file or static data path,
  or an inline legacy selector.

`lib/storeBackend.ts` owns the narrow backend seam. `createDualBackendStore`
only curries `selectStore(memory, supabase)` into a zero-argument getter. It
does not catch errors, infer table names, create queries, or decide
authorization. Fail-soft guards, schema-miss warnings, identity rules,
moderation, and cache policy stay in each store.

## Classification

- **factory-ready** - memory and Supabase implementations use one shared
  selector. The store may still have domain validation, but backend selection
  is a single seam.
- **factory-eligible, policy-heavy** - one shared selector exists, but the
  store owns moderation, trust, identity, media, authorization, or multi-step
  write policy. Keep that policy visible before a factory migration.
- **legacy-exception** - backend checks remain inline or are spread across
  operations. Refactor the selector first.
- **not dual-backend** - the store is file-backed, static plus live, or
  Supabase-only. The memory-or-Supabase factory does not apply.

## Canonical inventory

Every row below maps to one current `lib/*Store.ts` file. The test
`__tests__/storeBackendInventory.test.ts` compares these names with the
directory, so a new store or a removed store cannot leave this document
silently stale.

| Store | Classification | Notes |
|---|---|---|
| adultSelfAssertionStore | factory-ready | Account assertion read and record; adult policy lives in `socialLaunch`. |
| analyticsReceiptStore | factory-ready | Receipt selection uses the shared seam after #1523. |
| areaDemandStore | factory-ready | Demand signal with shared backend selection. |
| checkInStore | factory-ready | Check-in rows with shared backend selection. |
| commentsStore | factory-eligible, policy-heavy | Comment moderation and report flow. |
| communityPriceStore | factory-eligible, policy-heavy | Moderation, corroboration, venue signals, and Round source ownership. |
| contributorLeaderboardStore | legacy-exception | Inline Supabase configuration check; durable aggregate read. |
| crawlStoryStore | legacy-exception | Multiple inline Supabase configuration checks. |
| feedFreshnessStore | factory-ready | Pilot store; durable or memory freshness stamp. |
| followStore | factory-ready | Directed follow graph with shared backend selection. |
| harvestOverlayStore | factory-ready | Fold-written UK harvest overlays; one shared selector, with a `requireDurable` guard for the non-dry fold CLI. |
| identityHandleStore | factory-eligible, policy-heavy | Handle ownership, rename, reservation, and tombstone policy. |
| importNotesStore | not dual-backend | JSON-file store with memory fallback when the filesystem is unavailable. |
| messagesStore | factory-eligible, policy-heavy | Verified actor and membership policy; production refuses memory fallback. Failed thread reads throw a retryable unavailable error. |
| nightMemoryStore | legacy-exception | The removal pair uses the seam; 24 per-operation configuration branches remain in the source fixture. |
| nightProfileStore | factory-ready | Night Profile preference rows with shared backend selection. |
| notificationsStore | factory-ready | Notification rows with shared backend selection. |
| occupancyStore | factory-eligible, policy-heavy | Time window, retake, reporting, and moderation policy. |
| operatorProposalsStore | factory-ready | Operator proposal state has one backend selector. |
| pendingPlanRecapStore | factory-ready | Small pending-plan recap store. |
| pintDropsStore | factory-eligible, policy-heavy | Shared selector after #1523; Pint Drop and Storage policy stays explicit. |
| planCollaborationStore | factory-ready | Shared selector with `globalThis` memory state. |
| planGroupPrefsStore | factory-ready | Shared selector with `globalThis` memory state. |
| planInviteRsvpStore | factory-ready | Shared selector with `globalThis` memory state. |
| planStore | legacy-exception | Multiple inline Supabase configuration checks and plan policy. |
| presenceStore | factory-ready | Presence rows with shared backend selection. |
| priceTrustEventStore | factory-eligible, policy-heavy | Append-only trust events, reversals, and account credits. |
| privateIdentityStore | factory-ready | Private account identity rows with owner policy at its boundary. |
| profileCoverPhotoStore | factory-eligible, policy-heavy | Cover rotation, media generations, and moderation policy. |
| profileStore | factory-eligible, policy-heavy | Caller-owned profile writes, moderation state and durable report-RPC compatibility. |
| pubPalStore | legacy-exception | Multiple inline Supabase configuration checks around private Pub Pal state. |
| pushTokenStore | factory-ready | Device push registration rows. |
| ratingsStore | factory-ready | Drink and venue rating rows with shared backend selection; public reads expose summaries, not venue leaderboards. |
| reactionsStore | factory-ready | Pint Drop reactions with shared backend selection. |
| referralStore | factory-eligible, policy-heavy | Referral identity, milestone, and proof-expiry policy. |
| roundsStore | factory-eligible, policy-heavy | Round membership, spend-line provenance, and promotion policy. |
| savedPubsStore | factory-ready | Shared selector after #1523; profile bootstrap stays in the store. |
| socialConnectionStore | factory-ready | Connected provider rows with one backend selector. |
| socialCrewStore | not dual-backend | Supabase-only RPC store. |
| socialInteractionStore | factory-eligible, policy-heavy | Social relationship, block, and interaction policy. |
| socialGalleryStore | factory-eligible, policy-heavy | Owned staged uploads, ordered publication, and gallery edit replay. |
| socialPostConsentStore | factory-eligible, policy-heavy | Media and approved-tag reads select memory or Supabase; consent and admin operations remain durable. |
| socialPostStore | factory-eligible, policy-heavy | Moderation, visibility, gallery media, replay, edit versions, consent, and relationship policy. |
| stepOutNudgeStore | factory-ready | Nudge preference and send-stamp rows with shared backend selection. |
| venueOperatorsStore | factory-eligible, policy-heavy | Venue claim ownership and operator moderation policy. |
| venuePhotoStore | factory-eligible, policy-heavy | Photo cap, author projection, reports, and moderation policy. |
| visitReportsStore | factory-eligible, policy-heavy | Dated Visit Reports, flags, and moderator lanes. |
| walkRouteStore | factory-ready | Routed-leg cache; TTL calculation stays in the store. |
| wantedStore | factory-ready | Owner-scoped Wanted rows with shared backend selection. |
| weatherRecommendationStore | factory-eligible, policy-heavy | Authored Recommendation policy with `globalThis` memory state. |
| weatherSnapshotStore | factory-ready | Cron weather snapshot cache. |
| whatsOnListingStore | factory-ready | Cron What's-On listing rows and per-kind generation watermarks. |
| whatsOnStore | not dual-backend | Static bundle plus injectable live-fetch merge. |

## Exception list

The following stores intentionally stay outside the factory-ready path:

- **legacy-exception:** `contributorLeaderboardStore`, `crawlStoryStore`,
  `nightMemoryStore`, `planStore`, and `pubPalStore`. Per-operation branches remain explicit.
  `planStore` already selects its main interface at the seam; that does not remove its remaining branches.
  Owner: the maintainers reviewing the next issue #727 store slice.
- **not dual-backend:** `importNotesStore`, `socialCrewStore`,
  and `whatsOnStore`. Their storage premise is not
  memory-or-Supabase. Owner: not applicable for this factory.
- **policy-heavy:** `commentsStore`, `communityPriceStore`,
  `identityHandleStore`, `messagesStore`, `occupancyStore`,
  `pintDropsStore`, `profileStore`,
  `priceTrustEventStore`, `profileCoverPhotoStore`, `referralStore`,
  `roundsStore`, `socialGalleryStore`, `socialInteractionStore`, `socialPostConsentStore`, `socialPostStore`,
  `venueOperatorsStore`, `venuePhotoStore`, `visitReportsStore`, and
  `weatherRecommendationStore`. Their explicit policy requires a separate review before further migration.
  Some already use the factory; the label does not imply an unmigrated store.
  Owner: the maintainers reviewing that store's issue #727 contract.

## Inline backend references

This list records production files with textual `selectStore` or `isSupabaseConfigured` references, including imports and comments.
It includes non-store modules such as `lib/messageAuth.ts`. The documentation test compares the list with repository search results.
The separate machine-readable fixture in `__tests__/storeInventory.test.ts` counts actual calls through an AST scan.
It records 56 store-related modules and 56 other production files. These counts describe different sets.

<!-- inline-backend-references:start -->
```json
{
  "inlineBackendReferences": [
    "app/add/[handle]/page.tsx",
    "app/api/account/route.ts",
    "app/api/ask/route.ts",
    "app/api/auth/handle-password/route.ts",
    "app/api/check-ins/route.ts",
    "app/api/cron/cheap-pint-ping/route.ts",
    "app/api/cron/step-out-nudge/route.ts",
    "app/api/founding-members/route.ts",
    "app/api/identity/handle/claim/route.ts",
    "app/api/identity/handle/rename/route.ts",
    "app/api/me/night-profile/route.ts",
    "app/api/me/pending-plan-recaps/route.ts",
    "app/api/pint-drops/route.ts",
    "app/api/profiles/[handle]/follow/route.ts",
    "app/api/profiles/[handle]/route.ts",
    "app/api/profiles/directory/route.ts",
    "app/api/profiles/search/route.ts",
    "app/api/pub-pal/llm/route.ts",
    "app/api/pub-pal/voice-token/route.ts",
    "app/api/saved-pubs/list-follows/route.ts",
    "app/api/social/media/[mediaId]/route.ts",
    "app/api/starter-packs/[slug]/follow/route.ts",
    "app/api/starter-packs/route.ts",
    "app/bar-tab/[id]/opengraph-image.tsx",
    "app/bar-tab/[id]/page.tsx",
    "app/ledger/[id]/page.tsx",
    "lib/analyticsReceiptStore.ts",
    "lib/areaDemandStore.ts",
    "lib/checkInStore.ts",
    "lib/cityEnrichmentCheckpointStore.server.ts",
    "lib/commentsStore.ts",
    "lib/communityPriceStore.ts",
    "lib/contributorLeaderboardStore.ts",
    "lib/crawlStoryStore.ts",
    "lib/creatorListDiscoveryRoute.server.ts",
    "lib/crewFriendEdges.ts",
    "lib/emailProvider.ts",
    "lib/followStore.ts",
    "lib/followWrite.server.ts",
    "lib/freshnessStoreOverlay.ts",
    "lib/handlePasswordSignIn.ts",
    "lib/harvestOverlayStore.ts",
    "lib/heritage.ts",
    "lib/identityHandleStore.ts",
    "lib/mapSearchEvents.server.ts",
    "lib/messageAuth.ts",
    "lib/messagePhotoMedia.server.ts",
    "lib/messagesStore.ts",
    "lib/nightMemoryStore.ts",
    "lib/nightMomentMedia.ts",
    "lib/nightProfileStore.ts",
    "lib/nightSignalStore.server.ts",
    "lib/notificationsStore.ts",
    "lib/operatorProposalsStore.ts",
    "lib/pendingPlanRecapStore.ts",
    "lib/pintDropLookup.ts",
    "lib/pintDrops.ts",
    "lib/pintDropsStore.ts",
    "lib/planCollaborationStore.ts",
    "lib/planCrewIdentity.ts",
    "lib/planGroupPrefsStore.ts",
    "lib/planInviteRsvpStore.ts",
    "lib/planStore.ts",
    "lib/presenceStore.ts",
    "lib/privateIdentityStore.ts",
    "lib/profileCoverPhotoRoute.server.ts",
    "lib/profileCoverPhotoStore.ts",
    "lib/profileImageMedia.server.ts",
    "lib/profileImageRoute.server.ts",
    "lib/profileImageServe.server.ts",
    "lib/profileOwnership.ts",
    "lib/profileStore.ts",
    "lib/pubPalStore.ts",
    "lib/pushTokenStore.ts",
    "lib/ratingsStore.ts",
    "lib/reactionsStore.ts",
    "lib/referralStore.ts",
    "lib/roundPriceBudget.ts",
    "lib/roundsStore.ts",
    "lib/savedPubsStore.ts",
    "lib/serverEnv.ts",
    "lib/socialConnectionStore.ts",
    "lib/socialGalleryStore.ts",
    "lib/socialInteractionStore.ts",
    "lib/socialOAuth.ts",
    "lib/socialPostConsentStore.ts",
    "lib/socialPostCreateRequest.server.ts",
    "lib/socialPostMedia.server.ts",
    "lib/socialPostStore.ts",
    "lib/stepOutNudgeSelect.server.ts",
    "lib/storeBackend.ts",
    "lib/supabase.ts",
    "lib/trustedSigningKey.server.ts",
    "lib/uploadedImage.server.ts",
    "lib/venueOperatorsStore.ts",
    "lib/venuePhotoMedia.server.ts",
    "lib/venuePhotoServe.server.ts",
    "lib/venuePhotoStore.ts",
    "lib/visitReportsStore.ts",
    "lib/wantedPromotion.server.ts",
    "lib/weatherRecommendationStore.ts",
    "lib/weatherSnapshotStore.ts",
    "lib/whatsOnListingStore.ts",
    "scripts/build_pint_index_snapshot.mjs",
    "scripts/push/sendDailyBrief.mjs",
    "scripts/push/sendStepOutNudge.mjs"
  ]
}
```
<!-- inline-backend-references:end -->

## Existing pilot and current adopters

`feedFreshnessStore` was the first low-risk pilot. Its callers use the same
zero-argument selector before and after the factory wrapper, and its memory
and Supabase implementations keep their existing fail-soft behavior.

Current source has these eight factory adopters:

1. `adultSelfAssertionStore`
2. `feedFreshnessStore`
3. `harvestOverlayStore`
4. `occupancyStore`
5. `priceTrustEventStore`
6. `stepOutNudgeStore`
7. `walkRouteStore`
8. `wantedStore`

The former seven-adopter list omitted `harvestOverlayStore`.
This maintenance change retains all eight existing adopters and migrates none.
The helper remains a narrow call to `selectStore(memory, supabase)`.
The original pair, `feedFreshnessStore` and `occupancyStore`, has the contract matrix described below.
The [boundary review](reviews/store-pilot-closeout.md) records policy, tests and disposition for each other adopter.
These facts do not satisfy the issue's literal exactly-two wording.

### Issue #727: scope reconciliation

The [original issue](https://github.com/Singularityszn/pubmax/issues/727) requires exactly two low-risk pilots.
Its contract matrix covers keyless reads, configured reads, missing schema, reset isolation and production strictness.
It also requires a machine-readable inventory of interfaces, fallbacks, schema behaviour, authorization owners and reset helpers.

| Record | What it establishes | What it does not establish |
|---|---|---|
| Original #727 acceptance | Exactly two pilots, with per-store parity evidence. Policy stays outside the factory. | Approval for every current adopter. |
| First progress comment, after [#1155](https://github.com/Singularityszn/pubmax/pull/1155) | Calls the two-pilot count obsolete because seven stores already adopted the helper. Requests an acceptance update. | A completed scope update or waived parity matrix. |
| Second progress comment, after [#1158](https://github.com/Singularityszn/pubmax/pull/1158) | Explicitly retains the named two-pilot matrix and disposition of the other five adopters. Records production strictness and reset work. | Acceptance of widening; the comment explicitly keeps the issue open. |
| 5 September comment, [#1523](https://github.com/Singularityszn/pubmax/pull/1523) | Records selector cleanup and a source inventory. Lists remaining slices, ending with review scope in `npm run verify`. | Permission for a bulk factory rewrite or proof that all six slices landed. |
| Current candidate | Retains eight existing narrow adopters, completes the original pair matrix, and adds inventory fields and local review scope. | Satisfaction of the literal exactly-two clause or a passed integrated full gate. |

The number is stale as an implementation description. The issue wording still requires explicit reconciliation.
The proposed acceptance is: retain eight existing narrow adopters, prove the original pair, and record the other six dispositions.
The maintainer must record that replacement on #727 after reviewing this candidate.
Routine inventory, parity and local-gate maintenance does not depend on further migration or reverting six adopters.
The progress comments alone do not establish complete parity for all eight.

### Closeout checks

- [x] Correct current count: eight factory adopters, including `harvestOverlayStore`.
- [x] Record all requested inventory fields for 56 store-related modules and 56 other production files with inline calls.
- [x] Complete the original pair matrix: healthy configured paths, keyless paths, schema misses, write failures, resets and strictness.
- [x] Record each other adopter's policy, tests, disposition and remaining durable-proof limits.
- [x] Retain the existing CI category report and add local review scope before data generation in `npm run verify`.
- [x] Prevent local snapshot cancellation and generated-output provenance bypasses; execute the CLI through canonical or aliased paths.
- [ ] Reconcile #727 acceptance explicitly from exactly two adopters to the retained eight and original-pair matrix.
- [x] Integrate the reviewed durable nudge qualification fix and record its controlled race proof in this candidate.
- [ ] Supply the required full integrated gate evidence for the final combined candidate.

Checked entries record specific completed work. They do not close #727 or waive its unchecked requirements.

### Evidence for the pilot contract

The [boundary review](reviews/store-pilot-closeout.md) records the matrix and limits for all eight adopters.
The new pilot tests execute real store adapters and production guards with mocked Supabase responses.
They do not prove a deployed schema or durable production writes.

| Contract | Evidence in this candidate | Boundary |
|---|---|---|
| Keyless reads | `storePilotParity.test.ts` writes and reads both memory stores. Existing occupancy tests retain their memory contracts. | The named pair is feed freshness and occupancy. |
| Healthy configured paths | The same matrix checks feed upsert/read projection, occupancy insert/retake/read projection, flag RPC and unhide update. | This exercises the actual adapters, beyond selector identity. |
| Missing schema | The matrix checks preview/development memory fallback and each store's production read/write results. | Feed may return held metadata; occupancy returns a degraded read. Their existing policies differ. |
| Reset isolation | The matrix clears each store without clearing its peer or issuing durable writes. It also resets occupancy column compatibility. | This is the original pair's reset contract. Other reset limits remain in the inventory. |
| Production strictness | The matrix rejects unconfigured production. Feed write failure returns `failed: true`; occupancy write failure rejects. | Failed durable writes do not add memory rows. The helper and store policies remain unchanged. |
| Inventory | `storeBackendInventory.test.ts` checks all 53 exact store names and textual references. `storeInventory.test.ts` records every requested field, discovers modules and calls, and checks exported interfaces and reset helpers. | Automated discovery cannot prove every policy description. Descriptions require source review against this baseline. |
| CI and local review scope | CI passes base/head SHAs. The local verify command checks branch, index, working tree and untracked files before data generation. | Snapshot provenance, cancellation, alias execution and safe imports have real Git/subprocess regression coverage. |

The reconciled inventory suites passed 232 tests under Vitest 5 on 8 September 2026, with one worker and no cache.
These source-discovery checks cover the integrated Messages/Social files. They execute no store, route or database runtime.
The original pair matrix passed 13 cases during focused validation before the Vitest 5 integration.
The final guard and wiring tests passed 42 cases under Vitest 5 after the snapshot and alias fixes.
These earlier focused results are not a full combined verification result.
The three additional memory edge fixes and their focused proof remain separate in the boundary review.
They do not establish complete parity for every operation in all eight stores.

The original issue also requires lint, scoped typecheck, tests and verify evidence.
A bounded inventory check cannot substitute for those gates.
The final integrated gate remains required; this document supplies no blanket closure recommendation.

## Review-scope guard

`scripts/check_review_scope.mjs` reports source, migration, generated, regenerated, evidence, test, configuration, documentation, skill-pack and other paths.
It warns when a review crosses more than two runtime domains or more than 150 files.
It fails for unexplained generated paths and skill-pack paths.
The existing regeneration rules allow recognised generator inputs and their output in the same snapshot.
Migration files retain their own category and do not add a runtime domain.
CI passes the pull request base and head SHAs to the script.

Local verify runs `check:review-scope` before `validate-data` can generate files.
The local check uses the branch merge base and unions branch, index, working tree and untracked changes.
Each snapshot retains its regeneration provenance, so an unstaged generator change cannot excuse a generated-only commit.
Restoring base bytes in the working tree cannot hide committed or staged forbidden paths.
Canonical path comparison keeps CLI execution active through symlinks while imports remain safe on Node 22.

The check does not validate regenerated bytes, every intermediate commit, or changes made after its snapshots.
Those limits remain distinct from test, build and deployment evidence.
