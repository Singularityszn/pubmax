# Store backend inventory and factory pilot

Companion to issue #727 ("Spec: reduce store/review bloat without hiding
policy"). This is the inventory the issue asks for, plus a report on the
one-store pilot migration onto the narrow factory it proposes.

## Deviation from the issue's evidence

The issue's evidence section estimates "roughly 25 store modules, only two
with the simplest conformant shape." That has aged. As of this pilot:

- There are 45 `lib/*Store.ts` modules, not ~25.
- 33 of them already call the shared `selectStore<T>(memory, supabase)`
  helper in `lib/storeBackend.ts` as their single backend-selection seam, not
  "only two." `selectStore` already IS the narrow, domain-free factory the
  issue proposes building; the gap it leaves is that each store still
  hand-writes the same one-line wrapper function around it.
- The globalThis-anchored memory-state pattern (module state kept on
  `globalThis` so it survives dev-server hot reload) is used by only 6 of the
  45 stores: `analyticsReceiptStore`, `planCollaborationStore`,
  `planGroupPrefsStore`, `planInviteRsvpStore`, `planStore`,
  `weatherRecommendationStore`. It is not "the" dual-backend pattern; it is
  orthogonal to backend selection. Four of those six
  (`planCollaborationStore`, `planGroupPrefsStore`, `planInviteRsvpStore`,
  `weatherRecommendationStore`) already route through `selectStore`, so
  globalThis-anchoring and factory-eligibility are independent axes.
- `communityPriceStore` was named in this task's original brief as an example
  of the globalThis pattern. It is not: it keeps its memory state in a plain
  module-level `Map`, not `globalThis`, and already uses `selectStore` +
  `createFailSoftGuard`. It is excluded from the pilot for a different
  reason: it is the most policy-heavy store in the codebase (moderation,
  corroboration counting, round-source ownership, ~2,000 lines).
- This task migrates exactly ONE store onto the factory, not the issue's
  proposed two, per this task's own scope.
- The CI review-scope guard the issue lists as a fourth goal is out of scope
  for this task.

## Classification

Categories:

- **factory-ready** - single `selectStore` (or now `createDualBackendStore`)
  seam, one memory implementation, one Supabase implementation, no domain
  policy beyond CRUD and fail-soft reads. The factory's target shape.
- **factory-eligible, policy-heavy** - same single-seam shape, but the store
  carries real domain policy (moderation, trust scoring, authorization,
  multi-step write rules) beyond the backend choice itself. Adopting the
  one-line factory wrapper would be equally safe, but the store is a worse
  pilot pick: a defect there is expensive, and the factory change is not what
  most needs proving on a file that big.
- **legacy-exception** - the store does not use the shared seam at all; it
  checks `isSupabaseConfigured()` (or calls `requireSupabaseAdmin()`)
  inline, multiple times, scattered across its own operations. Needs its own
  refactor to a single seam before the factory helps it. Out of scope here.
- **not dual-backend** - the store does not follow the
  memory-or-Supabase-by-env shape at all (file-backed, static+live merge,
  Supabase-only). Out of scope for this factory by definition.

### Table 1: factory-ready (candidates for the wrapper)

| Store | Lines | Notes |
|---|---|---|
| feedFreshnessStore | 131 | Pilot. Migrated. No TTL, identity, or moderation coupling in the seam. |
| walkRouteStore | 126 | Smallest factory-ready store, but its `putLeg` computes a TTL expiry inline next to the seam - held back this round. |
| weatherSnapshotStore | 183 | Same shape as walkRouteStore; cron-written weather cache. |
| areaDemandStore | 172 | Same shape family (comment on walkRouteStore names it as a sibling). |
| checkInStore | 185 | |
| followStore | 279 | |
| nightProfileStore | 159 | |
| notificationsStore | 390 | |
| pendingPlanRecapStore | 188 | Top-3 candidate. Next adopter. |
| planCollaborationStore | 852 | globalThis-anchored memory state; still a single `selectStore` seam. |
| planGroupPrefsStore | 252 | globalThis-anchored memory state; single seam. |
| planInviteRsvpStore | 281 | globalThis-anchored memory state; single seam (2 selectStore call sites). |
| presenceStore | 272 | |
| privateIdentityStore | 293 | |
| pushTokenStore | 144 | Top-3 candidate. Next adopter. |
| reactionsStore | 196 | |
| socialConnectionStore | 169 | |
| priceConfirmStore | 300 | |
| profileStore | 501 | |
| ratingsStore | 288 | |
| operatorProposalsStore | 251 | |

### Table 2: not factory-ready this round

| Store | Lines | Category | Notes |
|---|---|---|---|
| commentsStore | 418 | factory-eligible, policy-heavy | Moderation/report flow. |
| communityPriceStore | 2065 | factory-eligible, policy-heavy | Moderation, corroboration, round-source ownership. See deviation note. |
| emailSubscribersStore | 341 | factory-eligible, policy-heavy | |
| identityHandleStore | 466 | factory-eligible, policy-heavy | |
| messagesStore | 483 | factory-eligible, policy-heavy | |
| referralStore | 619 | factory-eligible, policy-heavy | |
| roundsStore | 885 | factory-eligible, policy-heavy | |
| socialInteractionStore | 1285 | factory-eligible, policy-heavy | |
| socialPostStore | 928 | factory-eligible, policy-heavy | |
| venueOperatorsStore | 333 | factory-eligible, policy-heavy | |
| visitReportsStore | 596 | factory-eligible, policy-heavy | |
| weatherRecommendationStore | 469 | factory-eligible, policy-heavy | globalThis-anchored memory state; single seam. |
| analyticsReceiptStore | 87 | legacy-exception | globalThis-anchored memory state; inline `isSupabaseConfigured()`, not `selectStore`. |
| planStore | 954 | legacy-exception | globalThis-anchored memory state; 11 inline `isSupabaseConfigured()` call sites, not one seam. |
| crawlStoryStore | 644 | legacy-exception | 6 inline `isSupabaseConfigured()` call sites, one per crawl-source site. |
| nightMemoryStore | 1202 | legacy-exception | 25 inline `isSupabaseConfigured()` call sites - the most scattered store in the codebase. |
| pubPalStore | 221 | legacy-exception | 8 inline `isSupabaseConfigured()` call sites. |
| contributorLeaderboardStore | 81 | legacy-exception | 1 inline `isSupabaseConfigured()` call; not on the shared seam. |
| pintDropsStore | 945 | legacy-exception | 1 inline `isSupabaseConfigured()` call, otherwise not on the shared seam. |
| importNotesStore | 206 | not dual-backend | JSON-file store under `.data/`, memory fallback only when the filesystem is unavailable. No Supabase path. |
| whatsOnStore | 294 | not dual-backend | Static bundle + injectable live-fetch merge. No Supabase path. |
| socialCrewStore | 591 | not dual-backend | Supabase-only (RPC calls); no memory backend. |
| socialPostConsentStore | 260 | not dual-backend | Supabase-only (RPC calls); no memory backend. |
| savedPubsStore | 680 | unclassified - needs its own look | Reads as binary to `grep`/`file` in this worktree (pre-existing, unrelated to this task); its dual-backend shape could not be confirmed by the same method as the other 44 and needs a direct read outside this pilot's scope. |

Both tables together account for all 45 `lib/*Store.ts` modules.

## Top-3 pilot candidates

Ranked by lowest risk to prove zero behavior change:

1. **feedFreshnessStore** (chosen) - a bare stamp/read pair (last-revalidated
   metadata only). No TTL math, no identity, no moderation. Its callers
   never import the seam function itself, only `memoryFeedFreshnessStore`
   and `__resetFeedFreshnessStore`, so the migration touches zero test
   surface.
2. **pushTokenStore** - similarly small (144 lines) and single-purpose
   (register/clear a device push token). Named as the next adopter after
   this pilot lands.
3. **pendingPlanRecapStore** - 188 lines, same plain CRUD shape, no policy
   layer. Named as the next adopter after `pushTokenStore`.

`walkRouteStore` was the first pick in an earlier pass of this task, but its
`putLeg` computes a TTL expiry (`WALK_ROUTE_LEG_TTL_MS`) right next to the
seam call - not disqualifying, but more surface than the three above. It
reverted to its original hand-written wrapper for this round and stays a
fine next-next candidate.

## Exception list

Stores intentionally left off the factory, with reason:

- **legacy-exception** (`analyticsReceiptStore`, `planStore`, `crawlStoryStore`,
  `nightMemoryStore`, `pubPalStore`, `contributorLeaderboardStore`,
  `pintDropsStore`) - each checks Supabase configuration inline, more than
  once, instead of through one seam. The factory wraps `selectStore`; these
  stores do not call it yet, so there is nothing for the factory to wrap
  without a separate refactor of the store itself first. Owner: whoever picks
  up issue #727's next wave.
- **not dual-backend** (`importNotesStore`, `whatsOnStore`, `socialCrewStore`,
  `socialPostConsentStore`) - these do not choose between a memory and a
  Supabase implementation by environment; the factory's premise does not
  apply. Owner: n/a, out of scope by design.
- **savedPubsStore** - could not be inspected with the same tooling as the
  other 44 stores in this worktree (reads as a binary file to `grep`/`file`).
  Needs a direct read before anyone classifies it. Owner: whoever picks up
  issue #727's next wave.
- **factory-eligible, policy-heavy** stores (`commentsStore`,
  `communityPriceStore`, `emailSubscribersStore`, `identityHandleStore`,
  `messagesStore`, `referralStore`, `roundsStore`, `socialInteractionStore`,
  `socialPostStore`, `venueOperatorsStore`, `visitReportsStore`,
  `weatherRecommendationStore`) - technically as adoptable as the pilot
  store (same one-line seam), but not migrated in this pass because this
  task's scope is one pilot store, chosen for lowest risk. Adopting the
  factory here is a mechanical follow-up, not a design question.

## The factory

`lib/storeBackend.ts` already had `selectStore<T>(memory, supabase)` -
the narrow backend-selection seam the issue asks for. This task adds one
function on top of it:

```ts
export function createDualBackendStore<T>(memory: T, supabase: T): () => T {
  return () => selectStore(memory, supabase);
}
```

It curries `selectStore` into the zero-argument getter every dual-backend
store already hand-writes as its final few lines:

```ts
export function xStore(): XStore {
  return selectStore(memoryXStore, supabaseXStore);
}
```

becomes:

```ts
export const xStore = createDualBackendStore(memoryXStore, supabaseXStore);
```

Matching the issue's non-goals for the factory: it does not catch errors,
infer table names, generate queries, or decide authorization. It replaces
one boilerplate line per store and decides nothing `selectStore` did not
already decide.

### Open questions (deliberately not answered by this pilot)

- **Fail-soft guards.** Most factory-ready stores also wrap their Supabase
  implementation in `createFailSoftGuard` (schema-miss detection, degraded
  writes). The factory does not absorb this. `createFailSoftGuard` takes a
  per-store table name and migration hint, which is exactly the kind of
  domain detail the issue's non-goals say a shared factory must not infer.
  Whether a second, still-narrow helper should exist to compose
  `createFailSoftGuard` + `selectStore` together, or whether every store
  should keep wiring both by hand as `feedFreshnessStore` still does, is
  left open for the next wave.
- **Schema-miss warners.** `resetSchemaMissWarnings()` (the dedupe reset each
  guard exposes) is store-specific and test-only. The factory does not touch
  it, and no attempt was made to fold it in.

## Pilot: feedFreshnessStore

Picked `lib/feedFreshnessStore.ts` for the pilot:

- Smallest-surface, cleanest-seam candidate of the top-3 above: a bare
  stamp/read pair with zero identity, moderation, or TTL coupling anywhere
  near the seam.
- Its seam was a direct, unmodified `selectStore(memoryFeedFreshnessStore,
  supabaseFeedFreshnessStore)` wrapper - the exact boilerplate the factory
  removes, with no extra policy in the way.
- Its callers (`app/api/cron/refresh-night-signals/route.ts`,
  `app/api/cron/refresh-whats-on/route.ts`,
  `lib/freshnessStoreOverlay.ts`)
  all call it as a plain function, so converting it from a `function`
  declaration to a `const` arrow-returning factory result changes nothing at
  any call site.
- No test file imports the `feedFreshnessStore()` selector itself. The tests
  that exercise it (`__tests__/cronRefreshWhatsOnRoute.test.ts`,
  `__tests__/cronRefreshNightSignalsRoute.test.ts`,
  `__tests__/cronRefreshPricesRoute.test.ts`) import
  `memoryFeedFreshnessStore` and `__resetFeedFreshnessStore` directly and
  exercise the route handlers, which call the real, unmocked selector under
  test env conditions where Supabase is not configured. The migration
  touches zero test surface - the tests stayed untouched and green, which is
  the proof of zero behavior change.

The change: `lib/feedFreshnessStore.ts` now exports
`export const feedFreshnessStore = createDualBackendStore(memoryFeedFreshnessStore, supabaseFeedFreshnessStore);`
instead of hand-writing the wrapper function. `lib/storeBackend.ts` gained
`createDualBackendStore`, with a unit test in `__tests__/storeBackend.test.ts`
proving it curries `selectStore` correctly under both configured and
unconfigured Supabase env states.
