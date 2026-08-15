# PUBMAXX Trusted Pint-to-Crew Implementation Plan

**Status: APPROVED FOR NATIVE SOL FULL-DAG EXECUTION; SUPERVISOR IS SOLE PUSH/PR/MERGE GATE.**

## 1. Status and execution authorization

Planning complete. Owner returned and authorized remaining implementation on **2026-07-24**.

Binding locks:

- All 17 owner decisions adopted on **2026-07-23** remain closed.
- Full-DAG isolated lane implementation, verification, review, and local commits are authorized.
- Coordinator dispatches and records lanes only; all implementation occurs in subagents.
- Owner explicitly replaced prior `claudex`-only transport rule with native `gpt-5.6-sol` agents. Credential value, alias, export, or shell expansion must never appear.
- Every implementation, verification, and review pass uses native `gpt-5.6-sol`; effort remains `low`, `medium`, or `high`, never above `high`.
- Compact between every lane wave.
- Supervisor is sole push, PR, review-gate, and merge operator. Coordinator and lane agents perform no further push or PR action.
- No Vercel deploy or promotion.
- No domain or production mutation.
- Never touch live branch `feat/desktop-parity-d3-gazetteer`.

Baseline history and current integration base:

```text
B1 = 6958dc6170c82b87a1784d1b513ec8a897e89b58
PHASE_A_MERGED = 6ee249e6 (L00 + L01 + L05A)
CURRENT_SUPERVISOR_CONFIRMED_MAIN = 9071b3cf (PHASE_A_MERGED + L03 via PR #575)
INTERMEDIATE_REVALIDATION_PIN = f9b1c726588a1b0c341077539a7b21aebc029968
PRE_UPSTREAM_AUDIT_PIN = ea9608e7639de37ad54ac17d85d1a7f6d43723dc
```

`B1` remains the historical planning baseline. Phase A and L03 are now merged. New lanes use the latest supervisor-confirmed integration base and record its full fetched SHA before implementation; current confirmed tip is `9071b3cf`. Lane amendments preserve upstream Map desktop rail and banner staging, Near shell, Plan CTA tokens, shipped `lib/tonightListGrouping.ts` dedup, Pal navigation, FeedCard/auth presentation, and landing `PintDropStrip` fail-soft behavior. Primary checkout state is never a lane base.

---

## 2. Post-resolution panel record

### Panel consensus

Skeptic, architecture, and verification panels agreed:

1. Build around trusted pint-to-crew handoff.
2. Do not optimize raw Plan creation, copied links, Stories, broad Pub Pal, or city expansion first.
3. Accepted Venue, area, date, and provenance must never change silently.
4. One grounded Stop must remain useful when three grounded Stops cannot be supported.
5. Friend privacy must be enforced by server responses, not client rendering.
6. Client state cannot authorize grounding.
7. Tonight must distinguish request time from real source freshness.
8. Tests, feature flags, rollback, ownership, and staged release must be executable.
9. Every shared-file dependency must use reviewed predecessor SHAs.
10. No production action remains authorized during away mode.

Strongest product dissent remained definitive dated pint-price index first. Owner already resolved it: narrow price-freshness work remains P1 trust substrate, not replacement strategy.

### Blocker dispositions

| Panel blocker | Binding disposition |
|---|---|
| Signed-out Friend receives full `PlanState` | Server returns privacy-preview projection anonymously. Full state requires valid Plan member capability across HTML, RSC, API, OG, get-in, and recap surfaces. |
| One-Stop fallback contradicts exact-three code | Add explicit `anchor-only` success outcome. Persist one grounded Stop as draft Plan. Upgrade same Plan identity atomically to three Stops later. |
| One Stop could corrupt north-star metric | One Stop may be canonically grounded but remains `routeReady: false`. Emit verified `plan_draft_saved`, never `plan_accepted`. Emit `plan_accepted` once on first grounded three-Stop transition. |
| Grounding proof loses anchor and order | Grounding proof V2 binds exact ordered Stops, allowed alternatives, anchor Venue, source, result type, operation digest, and expiry. |
| Canonical anchor owner missing | `resolvePlanningAnchor()` becomes sole server-owned rehydration and eligibility seam. |
| State precedence cannot compare existing drafts | Version Plan and Route drafts, expose intake metadata, add pure arbitration resolver, and define legacy dual-write migration. |
| URL sync cannot support required Back behavior | Add owned selection-history sentinel and exact incoming-selection checkpoint flow. |
| `q=` omitted from onboarding intent | Shared `explicitMapIntent()` includes `q`, `sel`, `pubs`, `mode=build`, `plan=1`, `log=1`, valid intent, and restored mobile state. |
| Acceptance source guessed from current UI | Add typed selection origin. Only explicit acceptance writes intent. Browse selection remains separate. |
| Analytics props ambiguous or silently dropped | Add exact enums and event-specific required-prop validation. Invalid required prop rejects whole event. |
| Consent denominator unclear | Preservation telemetry is observational. Denominator uses received consented `planning_handoff_opened` events; DNT and denied sessions emit nothing. Post-open revocation remains disclosed censoring. |
| Verified Plan and join tokens incomplete | Server tokens bind Stops, grounded, anchored, route-ready state, and fixed source. Join returns verified `crew_committed` token. |
| Tonight freshness uses request time | `servedAt` stays request time. Source freshness becomes provider-observed, dataset-generated, or unknown. |
| Tonight groups after limit | End filtering, locality, grouping, deterministic sorting, diversity, then API limit. |
| Tonight ordering unstable | Tie-break: distance, confidence, source observation, start time, stable family key, stable Venue ID. |
| Rollback language lacks switches | Add typed server-owned flag registry with safe off states and tested mismatch combinations. |
| Browser and axe gates not executable | Add Playwright gate infrastructure, direct axe dependency, privacy scanner, performance sampling, and zero-skipped-test assertion. |
| One-shot deployment too risky | Release in independently reversible stages. Landing activates last. |
| Shared files still overlap | Single owner per critical file. Later change requires owner-lane amendment, full rerun, and new receipt. |
| Integration branch could hide edits | Integration worktree cherry-picks reviewed SHAs only. Any conflict returns to owning lane. No manual product-code resolution there. |

All blockers closed at planning-contract level. Product decisions remain unchanged.

---

## 3. Binding product contract

### 3.1 Primary loop

1. Person chooses **Find my pint**.
2. PUBMAXX returns dated, sourced pint evidence.
3. Person explicitly accepts one **Venue**.
4. **Map** opens with same Venue and accepted context.
5. Person explicitly makes Venue **Stop 1**.
6. **Plan** asks only unanswered questions.
7. Server produces either grounded three-Stop **Route**, grounded one-Stop draft, or visible conflict.
8. Person locks useful Plan without account wall.
9. **Friend** sees privacy-safe preview before joining.
10. Friend joins using name.
11. Full Route appears only after valid capability exists.

### 3.2 Trust invariants

- Accepted Venue never disappears, changes, or moves from Stop 1 silently.
- Accepted area never widens or changes silently.
- Accepted London date never changes silently.
- Client-carried evidence remains display context only.
- Server recomputes Venue, area, eligibility, price provenance, and freshness.
- Map browse selection does not equal Plan acceptance.
- Pin tap and ordinary `?sel=` deep link remain browse-only.
- Explicit **Use this Venue** or **Make it Stop 1** creates acceptance.
- Templates add mood, occasion, budget, or group context. Templates never override accepted geography.
- Onboarding never covers explicit intent.
- One grounded Stop remains useful. PUBMAXX never fabricates companions.
- Friend preview reveals value without leaking Venue or Route.
- Plan, Stop, Venue, Friend, Route remain canonical vocabulary.

### 3.3 Grounded Plan lifecycle and metrics

Server generation has exactly three outcomes:

```ts
type AnchoredGenerationResult =
  | {
      outcome: "route";
      grounded: true;
      routeReady: true;
      anchored: true;
      stops: [GroundedStop, GroundedStop, GroundedStop];
    }
  | {
      outcome: "anchor-only";
      grounded: true;
      routeReady: false;
      anchored: true;
      stops: [GroundedStop];
      reason: "ANCHOR_COMPANIONS_INSUFFICIENT";
    }
  | {
      outcome: "anchor-conflict";
      grounded: false;
      routeReady: false;
      anchored: true;
      stops: [];
      reason: AnchorConflictCode;
    };
```

Lifecycle:

- `anchor-only` is successful generation, not HTTP error.
- Person may:
  - Lock one-Stop draft Plan.
  - Adjust constraints and retry.
  - Explicitly remove accepted Venue.
- One-Stop Plan:
  - Keeps accepted Venue as Stop 1.
  - Keeps Plan ID, host capability, crew, date, and accepted source.
  - Supports privacy preview and name-only Friend join.
  - Does not offer ordinary Stop 1 swap.
  - Cannot be counted as grounded Route acceptance.
  - Emits server-verified `plan_draft_saved`.
- Later compatible generation atomically upgrades same Plan from one Stop to three.
- Upgrade:
  - Requires host capability.
  - Requires expected Route revision.
  - Requires valid V2 proof.
  - Keeps original anchor at index zero.
  - Sets `routeReadyAt` once.
  - Emits server-verified `plan_accepted` once.
- Existing direct/manual Plans stay usable. Ungrounded manual saves remain `plan_saved`, not north-star `plan_accepted`.
- `crew_committed` includes server-derived `routeReady`. North-star Friend proof counts only `routeReady: true`.

North-star funnel:

```text
venue_accepted
  to verified plan_accepted where grounded=true, anchored=true, routeReady=true, stops=3
  to verified crew_committed where routeReady=true
```

Copied links and `plan_invite_opened` never count as success.

---

## 4. Exact technical contracts

### 4.1 Feature flags

Single server-owned registry:

```text
lib/trustedHandoffFlags.server.ts
lib/trustedHandoffFlags.ts
```

Flags:

| Flag | Default | Off behavior |
|---|---:|---|
| `PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE` | off | No new PlanningIntent writes; existing Near/Map paths work. |
| `PUBMAX_TRUSTED_HANDOFF_INTENT_READ` | off | Stored intent ignored but preserved; generic Plan remains available. |
| `PUBMAX_ANCHORED_GENERATION` | off | Accepted Venue stays visible as provisional/manual Stop; no silent unanchored generation. |
| `PUBMAX_MAP_ROUTE_TRANSFER` | off | Existing Map preview remains; Plan may regenerate through existing path. |
| `PUBMAX_TONIGHT_GROUPING` | off | Retain shipped schedule-safe chain-duplicate collapse; disable only V2 server locality, diversity, and canonical grouped-response behavior. Ended-row filtering and honest freshness stay active. |
| `PUBMAX_PAL_HANDOFF` | off | Existing Pal result flow remains; no intent write. |
| `PUBMAX_LANDING_FIND_MY_PINT` | off | Existing landing hierarchy remains. |
| `PUBMAX_FRIEND_MEMBER_REHYDRATION_V2` | off | Everyone receives safe privacy preview; full member rehydration unavailable. Anonymous Route leakage remains impossible. |

Rules:

- Flags parsed once server-side from strict `0|1`.
- RSC page and API use same server reader.
- Client components receive immutable typed flag DTO from server.
- No independent client-side environment interpretation.
- Unknown values mean off.
- Tests cover all off, producer-only, consumer-only, and full-on.
- New request fields optional.
- New response fields additive.
- Parser tolerance remains after rollback.
- Privacy-safe anonymous projection is mandatory, not flag-disableable.

### 4.2 PlanningIntent V1

Storage key:

```text
pubmax:planning-intent:v1
```

Contract:

```ts
type PlanningIntentV1 = {
  version: 1;
  source: "near" | "map-search" | "tonight" | "pal";
  cityId: CityId;
  acceptedVenueId: string;
  acceptedArea:
    | { kind: "night-patch"; id: NightPatchId }
    | { kind: "borough"; name: string }
    | null;
  startsAt: string | null;
  displayEvidence: {
    kind: "price" | "whats-on" | "directory";
    observedAt: string | null;
  };
  acceptedAt: string;
  expiresAt: string;
};
```

Rules:

- `sessionStorage`.
- Maximum raw size: 4 KB.
- Exact keys only.
- Fixed enums only.
- Canonical ISO timestamps only.
- Maximum future clock skew: five minutes.
- `expiresAt === acceptedAt + 2 hours`.
- Read never refreshes expiry.
- `now === expiresAt` means expired.
- Invalid, expired, oversized, or unsupported values clear best-effort.
- Storage exceptions never block journey.
- Clear after successful Plan creation or atomic Plan upgrade, explicit dismissal, or expiry.
- Retain after generation failure.
- No coordinates, URLs, free text, Friend data, capability, raw query, or trusted proof.

### 4.3 Canonical planning anchor

One server seam:

```ts
resolvePlanningAnchor({
  cityId,
  venueId,
  startsAt,
  acceptedArea,
  now,
}): Promise<PlanningAnchorResult>
```

Owned files:

```text
lib/planningAnchor.server.ts
lib/planningAnchor.ts
app/api/plans/anchor/route.ts
```

Responsibilities:

- Resolve Venue aliases.
- Confirm city membership.
- Load canonical Venue.
- Resolve accepted area into canonical Night Area.
- Recompute price evidence and freshness.
- Check promoted state.
- Check reviewed safety exclusions.
- Check opening evidence for Route window.
- Check budget and accessibility compatibility.
- Return privacy-safe display DTO.
- Return machine-readable conflict.
- Feed exact same canonical DTO into generation.
- Never widen area to make anchor fit.

Conflict codes:

```ts
type AnchorConflictCode =
  | "ANCHOR_VENUE_INVALID"
  | "ANCHOR_CITY_MISMATCH"
  | "ANCHOR_AREA_CONFLICT"
  | "ANCHOR_PROMOTED"
  | "ANCHOR_SAFETY_EXCLUDED"
  | "ANCHOR_OPENING_CONFLICT"
  | "ANCHOR_BUDGET_CONFLICT"
  | "ANCHOR_ACCESS_CONFLICT"
  | "ANCHOR_ROUTE_CONFLICT";
```

`ANCHOR_COMPANIONS_INSUFFICIENT` is not anchor conflict. It produces successful `anchor-only`.

### 4.4 Grounding proof V2

```ts
type GroundingPayloadV2 = {
  v: 2;
  routeVenueIds: string[];       // exact server-selected order; length 1 or 3
  allowedVenueIds: string[];     // Route plus approved alternatives
  anchorVenueId: string | null;
  anchorSource: "near" | "map-search" | "tonight" | "pal" | null;
  outcome: "route" | "anchor-only";
  operationDigest: string;
  issuedAt: number;
  expiresAt: number;
};
```

Verification:

```ts
acceptedVenueIds === claims.routeVenueIds
anchored =
  claims.anchorVenueId !== null &&
  acceptedVenueIds[0] === claims.anchorVenueId
```

Rules:

- Anchor-constrained optimization evaluates only candidate sets containing anchor.
- Only permutations with anchor at index zero qualify.
- Anchor has no ordinary alternative or Swap action.
- Any manual Route edit invalidates proof.
- Explicit anchor removal clears anchor metadata and proof, then requires unanchored regeneration.
- V1 proofs remain valid only for legacy unanchored three-Stop creation.
- Anchored request with missing, invalid, expired, or tampered V2 proof returns explicit `422`.
- Idempotent replay requires same operation key and same payload digest.
- Same key with changed payload returns conflict.
- Proof expiry before lock forces refresh.

### 4.5 Versioned state and draft precedence

Keys:

```text
pubmax:plan-draft:v2
pubmax:plan-route-draft:v2
pubmax:plan-intake:v1
pubmax:planning-intent:v1
```

Plan draft:

```ts
type PlanDraftEnvelopeV2 = {
  storageVersion: 2;
  savedAt: string;
  expiresAt: string;
  origin: "manual" | "template" | "planning-intent";
  draft: StoredPlanDraft;
};
```

Route draft:

```ts
type PlanRouteDraftEnvelopeV2 = {
  storageVersion: 2;
  savedAt: string;
  expiresAt: string;
  origin: "manual" | "plan-generated" | "map-generated" | "planning-intent";
  anchorVenueId: string | null;
  anchorSource: PlanningSource | null;
  outcome: "route" | "anchor-only" | "unanchored";
  stops: StoredRouteStop[];
  alternatives: StoredRouteAlternatives;
  nightContext: NightContext | null;
  routeTotals: PlanRouteTotals | null;
  transportBasis: string | null;
  planningConfidence: PlanningConfidence | null;
  warnings: string[];
  groundingProof: string | null;
  operationKey: string | null;
  routeRevision: string | number | null;
  routeStale: boolean;
};
```

Bounds and expiry:

| Store | Limit | Expiry |
|---|---:|---:|
| PlanningIntent | 4 KB | 2 hours |
| Plan draft | 20 KB | 24 hours/session end |
| Plan intake | 12 KB | Existing 24 hours |
| Route draft | 40 KB | 24 hours |

Pure precedence resolver:

1. Explicit URL controls current surface and current inspection.
2. Valid non-empty Route draft controls Route preview.
3. Populated user Plan and intake fields remain authoritative.
4. Where V2 Plan and intake fields overlap, newest valid `savedAt` wins.
5. Legacy populated field wins over PlanningIntent regardless of unknown age.
6. PlanningIntent fills missing fields only.
7. Remembered area fills missing area only.
8. Product defaults fill remaining blanks.
9. `?sel=B` inspects B but never replaces accepted anchor A.
10. **Make it Stop 1** explicitly replaces A with B.
11. Conflicts produce visible receipt and recovery action.
12. Hydration arbitration finishes before any default write effect runs.

Legacy migration:

- Parse unversioned Plan and Route values.
- Mark result `legacy: true`; never invent `savedAt`.
- Treat populated values as existing user work.
- Never let PlanningIntent overwrite them.
- Migrate only on next explicit user write.
- During rollout, dual-write compatible V1 and V2 values.
- Keep V1 keys for at least two verified release stages.
- Invalid or expired proof recovers Route as ungrounded and visibly stale.
- No destructive storage clearing during rollback.

### 4.6 Exact URL and history contract

Explicit acceptance URL:

```text
/map?sel=<venueId>&accept=1&src=<near|map-search|tonight|pal>
```

Parameter semantics:

- `sel`: inspected Venue.
- `accept=1`: explicit accepted-handoff arrival.
- `src`: fixed acceptance source.
- `q`: explicit search arrival.
- `pubs`, `mode=build`, `plan=1`, `log=1`: existing explicit Map intentions.
- No date, coordinates, query text, source URL, capability, or Friend data added to URL.

History state:

```ts
type PubmaxSelectionHistory = {
  pubmaxSelection: 1;
  venueId: string;
};
```

Incoming selected arrival:

1. Freeze original URL before Map URL sync.
2. Replace incoming selected entry with clean `/map`, preserving owned non-selection parameters.
3. Push selected URL carrying `history.state.pubmaxSelection = 1`.
4. Back pops selected entry and reveals clean Map.
5. Second Back returns to Near, Tonight, Pal, or previous page.

In-Map behavior:

- Clean Map to first Venue selection: push one selected entry.
- Switching Venue while sentinel active: replace selected entry.
- Close uses `history.back()` only when current entry owns sentinel.
- Otherwise close locally and replace URL without `sel`, `accept`, or `src`.
- StrictMode guard prevents duplicate checkpoint.
- Reload retains selected state.
- Tab duplication recreates one clean checkpoint without duplicate push.
- URL sync merges owned passthrough parameters instead of dropping them.

### 4.7 Shared onboarding intent

```ts
explicitMapIntent({
  search,
  planningIntent,
  restoredMobileSession,
}): boolean
```

Recognized:

- `sel`
- `q`
- `pubs`
- `mode=build`
- `plan=1`
- `log=1`
- Valid PlanningIntent
- Restored selected Venue
- Restored planner/Route state

Rules:

- Generic tour and curated onboarding consume same answer.
- Suppression applies to current arrival only.
- Suppression never marks onboarding complete.
- Clean later Map open remains eligible.
- Explicit deep link must suppress tour before selected sheet mounts.
- Never more than one modal/scrim.
- Half sheet does not trap focus.
- Full sheet traps focus.
- Background interaction remains blocked as intended.
- Escape and scrim close top surface only.
- Focus returns to acceptance/search control.
- Reduced motion removes close-delay race.

### 4.8 Acceptance-source continuity

```ts
type PlanningSource =
  | "near"
  | "map-search"
  | "tonight"
  | "pal"
  | "direct-plan"
  | "mobile-route-preview";
```

Rules:

- Map selection records typed transient origin.
- Search result selection records `map-search`.
- Current non-empty search input is not proof of origin.
- Pin selection and generic `?sel=` remain browse-only.
- Tonight and Pal each own explicit **Use this Venue**.
- Near card owns explicit **Use this Venue**.
- Venue sheet owns **Make it Stop 1**.
- Opening details alone never writes intent or emits acceptance.
- Server verifies canonical Venue independently of source.

### 4.9 Analytics contract

Required events:

```ts
near_answer_ready: {
  source: "location" | "remembered-area" | "picked-area";
  resultBand: "0" | "1-3" | "4+";
}

venue_accepted: {
  source: "near" | "map-search" | "tonight" | "pal";
  hasArea: boolean;
  hasDate: boolean;
  hasProvenance: boolean;
}

planning_handoff_opened: {
  from: "near" | "map-search" | "tonight" | "pal" | "mobile-route-preview";
  to: "map" | "plan";
}

planning_handoff_preserved: {
  from: "near" | "map-search" | "tonight" | "pal" | "mobile-route-preview";
  to: "map" | "plan";
  venuePreserved: boolean;
  areaPreserved: boolean;
  datePreserved: boolean;
  provenancePreserved: boolean;
}

map_search_no_results: {}

tonight_result_opened: {
  kind: "sport" | "quiz" | "deal" | "music" | "gig" | "event" | "other";
  localityBasis:
    | "live-location"
    | "remembered-patch"
    | "remembered-borough"
    | "london-default";
}

plan_draft_saved: {
  stops: 1;
  grounded: true;
  anchored: true;
  routeReady: false;
  source: PlanningSource;
}

plan_accepted: {
  stops: 3;
  grounded: true;
  anchored: boolean;
  routeReady: true;
  source: PlanningSource;
}

crew_committed: {
  source: "shared-plan";
  participants: number;
  routeReady: boolean;
}
```

Validation:

- Required field missing or invalid rejects whole event.
- Unknown fields dropped.
- No Venue ID.
- No Plan ID.
- No invite or member capability.
- No coordinates.
- No query.
- No URL.
- No source URL.
- No Friend name or other Friend data.
- No free text.
- Verified delivery required for:
  - `plan_draft_saved`
  - `plan_accepted`
  - `crew_committed`
  - their `meaningful_core_action` derivatives where applicable
- `plan_invite_opened` remains soft client telemetry.
- `planning_handoff_preserved` remains observation, not server proof.

Metrics:

- Correctness target: 100% in deterministic tests.
- Telemetry denominator: server-received consented `planning_handoff_opened`.
- Numerator: matching `planning_handoff_preserved` in same anonymous session and analysis window.
- DNT and consent-denied sessions emit nothing and stay outside denominator.
- Consent revoked after opened remains disclosed right-censoring.
- Do not claim 98% guaranteed delivery.
- Establish first clean acceptance cohort after explicit acceptance ships.
- Only then measure 25% relative lift against later cohort or controlled rollout.

### 4.10 Server-enforced Friend privacy boundary

Anonymous DTO:

```ts
type PlanPrivacyPreviewDTO = {
  visibility: "preview";
  hostDisplayName: string;
  areaName: string | null;
  startLabel: string;
  stopCount: number;
  vibeLabel: string | null;
  accessibilitySummary: string | null;
  routeReady: boolean;
};
```

Anonymous response must omit:

- Plan title if user-entered.
- Crew list beyond allowed host display name.
- Venue IDs.
- Venue names.
- Stop order.
- Route geometry.
- Alternatives.
- Full Night Context.
- Pint evidence tied to a Venue.
- Member or invite capability.
- Recap Route and Pint Drop detail.

Full DTO:

```ts
type PlanMemberStateDTO = {
  visibility: "member";
  state: PlanState;
};
```

Full state requires valid host or guest capability.

Boundary applies to:

- `/plan/[id]` HTML.
- `/plan/[id]` RSC payloads.
- `/api/plans/[id]`.
- `/api/plans/[id]/getin`.
- `/api/plan-card`.
- `/plan/[id]/recap`.
- Metadata and Open Graph generation.
- Client refresh and realtime polling.

Join:

- Name-only join remains available.
- Successful join sets HttpOnly path-scoped capability cookie.
- Join response returns full member state and verified `crew_committed` token.
- Reload with valid capability returns full RSC member state.
- Expired, revoked, malformed, wrong-Plan, or missing capability returns preview only.
- OG card stays privacy-safe even when external crawlers cannot hold capability.

### 4.11 Tonight contract

Response:

```ts
type WhatsOnResponse = {
  rows: WhatsOnOfferGroup[];
  servedAt: string;
  sourceObservedAt: string | null;
  sourceFreshnessKind:
    | "provider-observed"
    | "dataset-generated"
    | "unknown";
  localityBasis:
    | "live-location"
    | "remembered-patch"
    | "remembered-borough"
    | "london-default";
};
```

Every raw row carries:

```ts
type SourceFreshness =
  | { kind: "provider-observed"; observedAt: string }
  | { kind: "dataset-generated"; observedAt: string }
  | { kind: "unknown"; observedAt: null };
```

Rules:

- CityMCP without provider timestamp becomes unknown.
- Never substitute `Date.now()` for source observation.
- Bundled dataset uses validated `generatedAt`.
- `servedAt` is request time only.
- Every card shows its own freshness.
- Header may say “Sources checked through…” only when aggregate timestamp is real.
- Unknown displays “Freshness unknown”.

Pipeline:

1. Remove ended rows.
2. Apply kind and service-window filters.
3. Compute locality.
4. Group exact offer instances.
5. Choose nearest family hero Venue.
6. Sort using deterministic tie-break.
7. Apply first-ten family diversity.
8. Apply API limit.

Exact group key:

```text
normalized title + kind + source publisher + normalized schedule
```

Family diversity key:

```text
normalized title + kind
```

Tie-break:

1. Locality distance ascending; missing last.
2. Confidence: confirmed, listed, derived.
3. Source observation descending; unknown last.
4. Start time ascending.
5. Stable group key.
6. Stable Venue ID.

Other rules:

- Distinct source or schedule never collapses.
- Raw rows remain under `alternatives`.
- Every alternate appears once.
- No family appears more than twice in first ten.
- Remembered borough uses stable canonical centroid when available.
- Missing borough centroid becomes `london-default`, never fake locality.
- Main list renders before Deals/Music treatment.
- Secondary lanes reuse already-loaded groups or move below main list.
- No duplicate first-viewport fetch or feed.

---

## 5. Scope

### P0: trusted handoff release

- Feature flags.
- Executable browser, axe, privacy, and performance gates.
- Analytics contract.
- PlanningIntent.
- Versioned state arbitration and legacy migration.
- Exact URL/history and onboarding behavior.
- Near and Map explicit Venue acceptance.
- Canonical anchor resolver.
- Grounding proof V2.
- Anchored generation.
- Grounded one-Stop Plan lifecycle.
- Server Friend privacy boundary.
- Plan client context, template, and date integrity.
- Map-generated Route transfer.
- Tonight freshness, grouping, locality, UI, and contrast.
- Narrow Pal locality and handoff.
- Map search no-results.
- MapLibre render and console health.
- Landing hierarchy and contrast.
- Full integration assembly and evidence.

### P1: price-index trust substrate

- Freshness coverage report by Night Area and Venue.
- Current, stale, dataset-generated, and unknown price states.
- Price-density gaps without false completeness.
- Definitive dated-price index evaluation.
- Plan intake compression based on P0 evidence.
- Tonight secondary-lane simplification.
- Consented funnel reporting.
- Quality dashboard with sample size and censoring.
- Post-night Stop confirmation and one fresh-price submission.

### Deferred

- Broad Stories expansion.
- Broad Pub Pal expansion.
- New cities.
- New map layers.
- New social breadth.
- New feed modes.
- New identity or follower mechanics.
- New content objects.
- Voice, memory, persona, or web-grounding expansion.
- Any work not improving price trust, Venue acceptance, Plan integrity, or Friend handoff.

---

## 6. SHA and branch rules

For every lane:

1. Start from exact `B1`.
2. Cherry-pick exact reviewed dependency SHAs in listed order.
3. Record resulting synthetic base as `BASE-Lxx`.
4. No implementation starts until `BASE-Lxx` is recorded.
5. Never start dependent lane from moving `main`.
6. No partial dependency commits.
7. No unreviewed dependency commit.
8. If cherry-pick conflicts, stop.
9. Conflict returns to file-owning lane.
10. Owner lane produces new commit, tests, verifier receipt, and review receipt.
11. Dependent base rebuilt from B1.
12. Lane receipt records dependency SHAs and final base SHA.

Reviewed, merged, and candidate SHAs at the current checkpoint:

```text
PHASE_A_MAIN = 6ee249e6 (L00 + L01 + L05A merged)
S02_CANDIDATE = 1c44a73e4f0dabc251a0be282bf33c1aff1c67aa (L02 verifier/reviewer PASS; supervisor gate pending)
S03_CANDIDATE = 2b4e2e8475c01a6d5419023bbb981d63166897a5 (L03 verifier/reviewer PASS)
S03_MAIN = 9071b3cf (L03 merged via PR #575; current supervisor-confirmed main tip)
S04 = assigned only after L04 implementer, verifier, and reviewer PASS
...
S19 = reviewed HEAD of L19
```

Later lane bases use the latest supervisor-confirmed integration tip plus any reviewed unmerged dependencies explicitly required by the DAG. Every receipt records the exact fetched base and dependency SHAs.

---

## 7. File-ownership matrix

| File or seam | Sole owner |
|---|---|
| `lib/trustedHandoffFlags.server.ts`, client flag DTO | L00 |
| `package.json`, `package-lock.json`, `playwright.config.ts`, gate scripts/helpers, `e2e/smoke.spec.ts`, `e2e/map-gl.spec.ts` baseline maintenance | L01 |
| `components/map/venueSheet.css`, dedicated mobile shared-sheet layout spec, and `components/mobile/mobileMapShell.css` only if selector exclusion is insufficient | L05A |
| `lib/analyticsEvents.ts`, `lib/verifiedAnalytics.server.ts`, `app/api/events/route.ts` | L02 |
| `lib/planningIntent.ts` | L03 |
| `lib/planDraft.ts`, new `lib/planRouteDraft.ts`, state resolver, intake metadata access | L04 |
| `components/PubMap.tsx`, `VenueInspector.tsx`, `MobileSharedSheet.tsx`, `useCrawlUrl.ts`, `useSelParamSync.ts`, first-run gates | L05 |
| `components/nearme/NearMeNow.tsx`, `lib/venueMapUrl.ts`, Near acceptance call sites | L06 |
| `lib/planningAnchor.server.ts`, anchor API, `lib/planGrounding.server.ts` | L07 |
| Generation request, optimizer, selection, generation route and DTO | L08 |
| `lib/plan.ts`, `lib/planStore.ts`, create/update APIs, one-Stop DB migration | L09 |
| Public/member Plan projections, Plan page, Plan card, get-in, recap, PlanCrew/PlanSummary privacy transition | L10 |
| `components/plan/PlanComposer.tsx`, `PlanIntake.tsx`, templates, `/plan` composer page, Plan composer CSS | L11 |
| `MobilePlanActivation.tsx`, Map-generated draft handoff | L12 |
| `lib/whatsOnStore.ts`, `lib/whatsOnHandler.ts`, API response and freshness mapping | L13 |
| Tonight grouping/locality pure helpers and `lib/tonight.ts` | L14 |
| `TonightClient.tsx`, Tonight CSS, Deals/Music secondary treatment | L15 |
| Pal client/API/context files | L16 |
| `MapSearchSuggest.tsx`, search CSS | L17 |
| Canvas filters, `PubMapCanvas.tsx`, GL console specs | L18 |
| Landing component and landing CSS | L19 |
| No source ownership; reviewed commit assembly only | L20 |

No other active lane may modify owned file. Needed cross-lane change becomes owner-lane amendment.

---

## 8. Corrected dependency DAG

```text
B1
├── L00 flags
│   ├── L02 analytics contract
│   └── L03 PlanningIntent
└── L05A mobile shared-sheet layout prerequisite
    └── L01 executable gates rebuilt on B1 + S05A
        ├── L13 Tonight freshness (also needs L00)
        ├── L17 search (also needs L02)
        └── L18 render health

L03 PlanningIntent
├── L04 draft arbitration
└── L07 anchor/proof

L02 + L03 + L04 + L05A + L01
└── L05 Map history/onboarding/Map acceptance
    └── L06 Near acceptance

L07 anchor/proof
└── L08 anchored generation
    └── L09 one-Stop lifecycle (also needs L02)
        ├── L10 Friend privacy (also needs L02)
        └── L11 Plan client (also needs L02-L06, L08, L10)
            └── L12 Map Route transfer (also needs L04, L08)

L13 Tonight freshness
└── L14 grouping/locality
    └── L15 Tonight UI (also needs L02, L03, L05, L06)
        └── L16 Pal

L19 landing runs after L11 trusted-handoff E2E.
L20 integration assembly consumes S00, S05A, and S01-S19 in recorded topological order.
```

Safe dispatch waves:

- Wave A: L00, then narrow L05A prerequisite, then rebuild/replay L01 on exact `B1 + S05A`.
- Wave boundary: checkpoint exact L01 candidate state, compact context, then dispatch L02 and L03 from exact `B1 + S00`; their bases do not consume S01.
- Fresh distinct L01 verifier and reviewer run against unchanged `S01_CANDIDATE`; send final `RR-L01` with `RR-L00` to supervisor before any L04+ lane starts.
- After reviewed S05A+S01, L18 may run; Wave C after S00+S05A+S01 permits L13, after S05A+S01+S02 permits L17, and after reviewed S03 plus receipt gate permits L04 and L07.
- Wave D after S00+S05A+S01+S02+S03+S04: full L05; after S07: L08; after S13: L14.
- Wave E after S02+S03+S05: L06; after S02+S07+S08: L09.
- Wave F after S02+S09: L10; after S02+S03+S05+S06+S14: L15.
- Wave G after S02+S03+S04+S05+S06+S08+S09+S10: L11; after S15: L16.
- Wave H after S04+S08+S11: L12.
- Wave I: L19 only after trusted handoff E2E passes with L11.
- Wave J: L20 only after every included lane has valid receipts, including `RR-L05A` and rebuilt `RR-L01`.

### Current foundation-wave execution record

- **Phase A complete:** L00, rebuilt L01, and L05A passed independent implementation, verification, and review gates. Supervisor pushed and merged them; Phase A landed on `main` as `6ee249e6`. Lane agents performed no supervisor-reserved push, PR, merge, deployment, or production mutation.
- **L03 complete and merged:** Final candidate `2b4e2e8475c01a6d5419023bbb981d63166897a5` passed verifier and reviewer with Critical/High/Medium/Low `0/0/0/0`. Supervisor merged PR #575 as `9071b3cf`, satisfying S03 for L04. `RR-L03` was sent.
- **L02 complete and awaiting supervisor gate:** Final candidate `1c44a73e4f0dabc251a0be282bf33c1aff1c67aa` remains based on `6ee249e603aae13179c90bcb7706d5c01805d67f`. Revision fixed cross-tab consent revocation so stale verified events cannot be resurrected after regrant, added deterministic two-window coverage, and corrected `docs/METRICS_FUNNEL.md`. Fresh verifier and reviewer both returned `PASS` with `0/0/0/0`; focused verification passed 118/118, exact CI passed 549 files/5,394 tests, and Playwright passed 3/3 with zero failures, skips, or retries. `RR-L02` is ready for supervisor gate. No lane push, PR, merge, or deployment occurred.
- **L04 active:** Draft arbitration implementer is running from supervisor-confirmed base `9071b3cf`; fresh verifier and reviewer tasks follow. L04 preserves explicit URL control, valid Route draft precedence, populated Plan/intake authority, newest valid V2 overlap resolution, legacy-over-intent safety, fill-missing-only behavior, selection-versus-anchor separation, conflict recovery, and arbitration-before-default-write behavior.
- **Wave boundary:** Record this exact state, send `RR-L02`, then compact. After compaction, continue L04 and dispatch only lanes whose DAG prerequisites are reviewed or merged against the latest supervisor-confirmed integration base.

---

## 9. Numbered implementation lanes

### L00 — Executable feature flags

- **Goal:** One typed, server-owned rollout and rollback system.
- **Branch:** `infra/trusted-handoff-flags`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-trusted-handoff-flags`
- **Owned files/seams:** New flag registry, public DTO, strict parser, unit tests.
- **Excluded:** Product behavior and call-site changes.
- **Dependencies:** None.
- **Base-SHA rule:** `BASE-L00 = B1`.
- **Roles:** Implementer `medium`; verifier `medium`; reviewer `medium`.
- **Feature flag:** None; this lane creates registry.
- **Tasks:** Register all eight flags; strict `0|1`; server-to-client DTO; unknown-off behavior; ownership/removal metadata.
- **Deterministic tests:** Missing, `0`, `1`, malformed, whitespace, unknown flag, server/client DTO equality, all-off and full-on snapshots.
- **Browser proof:** All flags off produces current navigation without runtime error; flag DTO contains no secret values.
- **Rollback:** Revert registry commit before any consumer ships.
- **Review receipt:** `RR-L00`, exact SHA, flag table, parser tests, no secrets.
- **Done:** Registry reviewed; all flags default off; no product output changed.

### L01 — Executable quality gates

- **Goal:** Turn browser, axe, privacy, performance, and zero-skip requirements into commands.
- **Branch:** `test/trusted-handoff-gates`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-trusted-handoff-gates`
- **Owned files/seams:** `package.json`, lockfile, `playwright.config.ts`, gate scripts, shared E2E helpers, and current-B1 baseline maintenance in `e2e/smoke.spec.ts` and `e2e/map-gl.spec.ts`.
- **Excluded:** Product fixes.
- **Dependencies:** `S05A`.
- **Base-SHA rule:** `BASE-L01-R2 = B1 + S05A`; replay/squash the complete reviewed L01 diff onto this synthetic base. Earlier L01 receipts are invalid.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** None; test-only.
- **Tasks:** Add direct axe dependency; honor `PW_NEXT_DIST_DIR`; JSON-result checker; no-conditional-skip checker; privacy response scanner; screenshot and performance helpers. Maintain current B1 smoke and GL expectations without weakening assertions: current landing/feed/control names, supported sheet-detent interaction, sustained full-map `<2%` idle stability, and deterministic delayed-tile readiness ceiling.
- **Deterministic tests:** Gate checker fails on skip, unexpected retry, zero discovered tests, malformed report, axe serious/critical, forbidden privacy token.
- **Browser proof:** Existing smoke, GL, no-GL, performance, mobile-feed, and axe fixtures run from isolated build. Final smoke/GL/no-GL matrix must report zero failures, zero skips, and zero retries.
- **Rollback:** Revert test-infrastructure commit; no runtime effect.
- **Review receipt:** Rebuilt `RR-L01`, exact `BASE-L01-R2`, package diff, tool versions, intentional failing/passing fixtures, matrix counts, and confirmation no code changed after fresh review.
- **Done:** Exact commands in Section 11 work from clean install and isolated build; all earlier L01 receipts remain invalidated.

### L02 — Analytics and verified outcome contract

- **Goal:** Privacy-safe, required-prop, server-verifiable measurement.
- **Branch:** `feat/trusted-handoff-analytics`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-trusted-handoff-analytics`
- **Owned files/seams:** Analytics registry, sanitizer, verified tokens, ingest route, analytics tests.
- **Excluded:** Product call sites.
- **Dependencies:** `S00`.
- **Base-SHA rule:** `B1 + S00`.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** None; registry additions dormant until callers.
- **Tasks:** Add exact event schemas; reject invalid required props; add source/locality enums; verified draft/accept/join token builders; verified-delivery requirement.
- **Deterministic tests:** Every required field; altered Stops, anchored, source, routeReady; unsafe IDs/query/URL/coordinates/Friend/capability; consent denied; DNT; revoked mid-flush; replay and token expiry.
- **Browser proof:** Consent-granted fixture sends fixed sanitized event; denied/DNT sends zero requests.
- **Rollback:** Remove dormant event entries only if no caller shipped; otherwise leave tolerant registry.
- **Review receipt:** `RR-L02`, sanitizer matrix and token-tamper evidence.
- **Done:** Invalid discriminator cannot produce empty event; verified outcomes fail closed.

### L03 — PlanningIntent contract

- **Goal:** One strict, short-lived acceptance envelope.
- **Branch:** `feat/planning-intent-contract`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-planning-intent`
- **Owned files/seams:** `lib/planningIntent.ts` and tests.
- **Excluded:** Surface integration.
- **Dependencies:** `S00`.
- **Base-SHA rule:** `B1 + S00`.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flags:** Intent write and read definitions; no caller yet.
- **Tasks:** Implement schema, 4 KB bound, exact keys, tagged area, clocks, clear/retain rules, injectable storage and clock.
- **Deterministic tests:** Valid, optional nulls, malformed JSON/array/scalar, unknown version/key/city, oversized, bad ISO, future skew, exact expiry, storage throws, dismissal, generation failure, successful clear.
- **Browser proof:** Storage blocked still permits generic Map and Plan.
- **Rollback:** Disable callers; parser remains harmless.
- **Review receipt:** `RR-L03`, full parser matrix.
- **Done:** Read never extends TTL; unsafe data rejected.

### L04 — Draft arbitration and migration

- **Goal:** Deterministic authority across Route, Plan, intake, intent, and remembered area.
- **Branch:** `feat/plan-draft-arbitration`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-plan-draft-arbitration`
- **Owned files/seams:** `lib/planDraft.ts`, new `lib/planRouteDraft.ts`, intake metadata accessor, pure resolver.
- **Excluded:** `PlanComposer.tsx`.
- **Dependencies:** `S03`.
- **Base-SHA rule:** `B1 + S03`.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** Intent read controls whether resolver considers PlanningIntent.
- **Tasks:** V2 envelopes; size/TTL rules; metadata-preserving intake parser; arbitration before write; V1 parsing and dual-write migration.
- **Deterministic tests:** Clean, Route draft, newer Plan, older Plan, legacy Plan, legacy Route, newer intent, expired proof, replay key, tab duplication, storage failure.
- **Browser proof:** Existing newer Plan remains unchanged when valid intent exists.
- **Rollback:** Turn intent read off; keep V1/V2 parsers and dual-write.
- **Review receipt:** `RR-L04`, precedence table with every expected winner.
- **Done:** No silent overwrite; no invented legacy timestamp.

### L05A — Mobile shared-sheet layout prerequisite

- **Goal:** Restore canonical bottom-anchored mobile sheet geometry so every supported detent keeps Venue actions reachable.
- **Branch:** `fix/mobile-shared-sheet-layout-prereq`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-mobile-shared-sheet-prereq`
- **Owned files/seams:** `components/map/venueSheet.css`, new `e2e/mobile-shared-sheet-layout.spec.ts`, and `components/mobile/mobileMapShell.css` only if excluding `.mobileSharedSheet` from legacy selectors proves insufficient.
- **Excluded:** Intent/history work, product redesign, broad CSS overrides, unrelated Map or sheet behavior, and L01 gate infrastructure.
- **Dependencies:** None.
- **Base-SHA rule:** `BASE-L05A = B1`.
- **Roles:** Implementer `medium`; verifier `high`; reviewer `high`; all distinct native `gpt-5.6-sol` agents.
- **Feature flag:** None; prerequisite correction for existing B1 behavior.
- **Tasks:** Exclude canonical portal `.mobileSharedSheet` from legacy viewport-height/translate rules so `mobileMapShell.css` bottom-anchored `height:auto`, capped flex-column layout wins. Preserve legacy non-portal drawer geometry.
- **Deterministic tests:** Selector precedence, portal/non-portal class combinations, footer containment, scroll-body flex behavior, and no desktop override.
- **Browser proof:** At 390×844, Venue footer remains fully inside viewport and real Pint Drop action is clickable at peek, half, and full detents; body scrolls while footer stays pinned; planner/contextual portal sheets remain valid; legacy non-portal drawer remains valid. At 1440×900 desktop remains unchanged. Capture light, dark, and reduced-motion evidence with zero browser errors, skips, or retries.
- **Rollback:** Revert only S05A after confirming legacy behavior; never reintroduce unreachable portal actions.
- **Review receipt:** `RR-L05A`, exact B1/base/head, viewport geometry, action click, scroll/pinned-footer proof, screenshots, clean CI, separate verifier/reviewer, and zero unresolved critical/high findings.
- **Push gate:** `S05A` remains local and ineligible for supervisor push until rebuilt L01 axe and full zero-failure/skip/retry matrix pass.
- **Done:** Reviewed `S05A` unblocks rebuilt L01. Full L05 later consumes S05A and must not recreate or revert this CSS fix.

### L05 — Map intent, history, onboarding, and modal safety

- **Goal:** Explicit Map arrival survives while Back, close, focus, and onboarding remain correct.
- **Branch:** `fix/map-intent-history-onboarding`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-map-intent-history`
- **Owned files/seams:** `PubMap.tsx`, URL sync hooks, first-run gates, curated onboarding integration, `MobileSharedSheet`, upstream `MapDesktopRail.tsx`, `mapDesktopRail.css`, `mapBannerStaging.css`, and their unit/E2E specs. Consume reviewed S05A sheet geometry without recreating or reverting it.
- **Excluded:** Near, Tonight, Pal acceptance buttons; S05A-owned layout correction.
- **Dependencies:** `S00`, `S05A`, `S01`, `S02`, `S03`, `S04`.
- **Base-SHA rule:** Cherry-pick in listed order.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flags:** Intent read controls restored-intent detection; intent write controls explicit Map-search and Venue-sheet acceptance.
- **Upstream baseline:** Preserve desktop rail, planner-drawer coexistence, venue-drawer exclusion, dynamic loading, mobile exclusion, and ambient-banner suppression while onboarding is open.
- **Tasks:** Shared `explicitMapIntent`; include `q`; freeze arrival URL; sentinel state machine; preserve parameters; typed selection origin; Map-search and Venue-sheet **Make it Stop 1**; one-modal rule; focus restoration; scoped Map contrast. Do not regress upstream rail/banner staging.
- **Deterministic tests:** Near, Tonight, Pal, direct URL, reload, duplicate tab, StrictMode, close without sentinel, `q` race, restored/expired intent, browse-only pin selection, Map-search acceptance source, rail visibility by drawer state, no duplicate Conditions control, and no mobile rail fetch/bundle.
- **Browser proof:** At 390×844 and 1440×900, Back closes sheet then leaves Map; no tour under sheet; later clean Map shows tour; desktop rail remains correct with planner and Venue drawers.
- **Rollback:** Revert history logic only to reviewed previous behavior; retain onboarding collision safety if independently valid.
- **Review receipt:** `RR-L05`, history entries, focus sequence, modal count, screenshots.
- **Done:** No explicit intent obscured or lost; Back contract exact.

### L06 — Explicit Venue acceptance continuity

- **Goal:** Distinguish browsing from accepting Venue into Plan.
- **Branch:** `feat/venue-acceptance-continuity`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-venue-acceptance`
- **Owned files/seams:** Near cards, `NearMeNow`, dedicated planning URL helper, intent writer, and acceptance call sites. L05-owned Map seam is consumed but not edited.
- **Excluded:** `PubMap.tsx`, Map-search acceptance, Tonight buttons, Pal buttons, `NearPageClient.tsx`, and `nearPage.css` baseline shell.
- **Dependencies:** `S02`, `S03`, `S05`.
- **Base-SHA rule:** Cherry-pick exact reviewed SHAs.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** Intent write; off keeps browse-only link.
- **Upstream baseline:** Standard `SiteNav` and centered Near shell are already shipped. Preserve them; never restore removed custom back-arrow shell.
- **Tasks:** Near **Use this Venue**; `accept=1&src=near` URL; Near evidence receipt; exact source telemetry; storage-failure fallback.
- **Deterministic tests:** Opening details writes nothing; generic Near card link remains browse-only; **Use this Venue** writes source `near`; malformed source is ignored; storage failure keeps canonical selected URL; standard Near shell remains.
- **Browser proof:** Near to Map preserves Venue, area, date, evidence kind, observation date; storage failure still selects Venue.
- **Rollback:** Disable intent writes; keep canonical browse URL and Map.
- **Review receipt:** `RR-L06`, acceptance-versus-browse request/event evidence.
- **Done:** Source never guessed; silent acceptance impossible.

### L07 — Canonical anchor and proof V2

- **Goal:** Establish one server truth for accepted Venue and proof.
- **Branch:** `feat/planning-anchor-proof-v2`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-planning-anchor-proof-v2`
- **Owned files/seams:** Anchor resolver/API, grounding proof implementation, anchor tests.
- **Excluded:** Optimizer and Plan UI.
- **Dependencies:** `S03`.
- **Base-SHA rule:** `B1 + S03`.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** None for resolver/proof support; generation consumer remains off.
- **Tasks:** Canonical resolver; V2 sign/verify; exact order; anchor/source/outcome; V1 compatibility; stable conflicts.
- **Deterministic tests:** Alias, unknown, wrong city, area, promoted, excluded, opening, budget, access, tampering, expiry, operation replay.
- **Browser proof:** Anchor preflight returns canonical display DTO; raw PlanningIntent evidence never authorizes result.
- **Rollback:** Stop V2 generation; retain V1 legacy verification.
- **Review receipt:** `RR-L07`, signed-claim redacted metadata and tamper matrix.
- **Done:** Server proves exact Stop 1 and source.

### L08 — Anchored generation

- **Goal:** Return honest Route, anchor-only, or conflict.
- **Branch:** `feat/anchored-plan-generation`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-anchored-plan-generation`
- **Owned files/seams:** Generation parser, optimizer, candidate selection, generation API and DTO.
- **Excluded:** Durable Plan creation and UI.
- **Dependencies:** `S07`.
- **Base-SHA rule:** `B1 + S07`.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** Anchored generation; off rejects optional anchor path without affecting legacy generation.
- **Tasks:** Preflight anchor independently; constrain permutations; no Stop 1 alternatives; one/two companion fallback; exact conflict response.
- **Deterministic tests:** Anchor highest/lowest score, alternate order better, duplicates, only one/two compatible Venues, date/area change, explicit removal.
- **Browser proof:** Fixed generation fixture shows exact anchor first and no fabricated Stop.
- **Rollback:** Disable anchored generation; preserve provisional accepted Stop.
- **Review receipt:** `RR-L08`, optimizer candidate/order report.
- **Done:** Every successful anchored result carries valid V2 proof.

### L09 — Grounded one-Stop Plan lifecycle

- **Goal:** Persist useful one-Stop Plan and upgrade same identity safely.
- **Branch:** `feat/one-stop-plan-lifecycle`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-one-stop-plan-lifecycle`
- **Owned files/seams:** Plan model/store, create/update APIs, migration/RPC, route-ready transition.
- **Excluded:** Public privacy rendering and composer UI.
- **Dependencies:** `S02`, `S07`, `S08`.
- **Base-SHA rule:** Exact reviewed commits only.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** Anchored generation.
- **Tasks:** Persist anchor metadata/outcome/proof digest; one Stop as draft; atomic one-to-three update; immutable `routeReadyAt`; idempotent accepted token.
- **Deterministic tests:** Create one Stop, invite/join, upgrade, same Plan/crew/date, duplicate upgrade, changed payload, expired proof, completion, collaboration limitations.
- **Browser proof:** One-Stop Plan reloads, previews, joins, then upgrades without new Plan ID.
- **Rollback:** Disable anchored generation; existing one-Stop Plan remains readable/editable and never silently expands.
- **Review receipt:** `RR-L09`, migration forward/back compatibility and atomicity evidence.
- **Done:** One Stop never emits `plan_accepted`; first valid three-Stop transition emits once.

### L10 — Server-enforced Friend privacy

- **Goal:** Remove every signed-out Route leak.
- **Branch:** `fix/friend-plan-privacy-boundary`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-friend-plan-privacy`
- **Owned files/seams:** Plan projections, public/member APIs, Plan page, metadata, OG card, get-in, recap, join transition, PlanCrew/PlanSummary boundary.
- **Excluded:** Plan generation and composer.
- **Dependencies:** `S02`, `S09`.
- **Base-SHA rule:** Exact reviewed commits.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** Member rehydration V2; off remains preview-only and safe.
- **Tasks:** Preview DTO; capability-aware server reads; safe metadata/card; post-join full fetch/RSC; verified join token.
- **Deterministic tests:** Missing, valid, malformed, expired, revoked, wrong-Plan capability; one and three Stops; host and guest.
- **Browser proof:** Anonymous HTML/RSC/API/OG/get-in/recap contain no forbidden Venue/Route data; join reveals exact Route.
- **Rollback:** Disable member rehydration to preview-only. Never restore anonymous full state.
- **Review receipt:** `RR-L10` plus mandatory privacy receipt.
- **Done:** Zero pre-join Route leakage. Any leak blocks all later lanes.

### L11 — Anchored Plan client, context, templates, and date

- **Goal:** Consume accepted context without repeated questions or silent contradiction.
- **Branch:** `feat/anchored-plan-client`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-anchored-plan-client`
- **Owned files/seams:** `PlanComposer.tsx`, `PlanIntake.tsx`, templates, `/plan` page, composer CSS.
- **Excluded:** `PlanSummary`, public Plan page, Map generator.
- **Dependencies:** `S02`, `S03`, `S04`, `S06`, `S08`, `S09`, `S10`.
- **Base-SHA rule:** Exact ordered cherry-picks; conflict returns to owner.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flags:** Intent read and anchored generation.
- **Upstream baseline:** Plan primary CTA selectors already use `--accent-action`, `--accent-action-strong`, and `--color-on-accent`. Preserve them; never revert those selectors while editing composer CSS.
- **Tasks:** Hydration arbitration; accepted summary; skip answered area/date; one-Stop lock; conflict recovery; explicit anchor removal; template structure; London service-date label.
- **Deterministic tests:** Soho plus Cheap round; non-today date; newer draft; legacy draft; anchor-only; conflict; removal; proof expiry; Plan CTA token regression.
- **Browser proof:** Accepted context appears before intake; no second area/date question; Friend later receives same date and Stops.
- **Rollback:** Intent read off, anchored generation off; generic Plan remains.
- **Review receipt:** `RR-L11`, state-before/state-after and exact request counts.
- **Done:** No default write precedes arbitration; no silent template geography.

### L12 — Map-generated Route transfer

- **Goal:** Open identical Map Route in Plan without regeneration.
- **Branch:** `feat/map-route-plan-transfer`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-map-route-plan-transfer`
- **Owned files/seams:** `MobilePlanActivation.tsx`, Map Route-to-draft transfer seam.
- **Excluded:** Route draft parser and PlanComposer.
- **Dependencies:** `S04`, `S08`, `S11`.
- **Base-SHA rule:** Exact reviewed SHAs.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** Map Route transfer.
- **Tasks:** Preserve Stops, alternatives, anchor, Night Context, totals, basis, confidence, warnings, proof, operation key, timestamps, origin.
- **Deterministic tests:** Complete write/read, malformed response, expired draft, missing proof, storage failure, duplicate navigation.
- **Browser proof:** **Open Plan to lock it in** makes zero additional generation requests and preserves exact Stop order.
- **Rollback:** Disable transfer; retain Map preview and existing Plan generation.
- **Review receipt:** `RR-L12`, generation request count and draft dump without secret proof value.
- **Done:** Plan renders recovered Route before regeneration action.

### L13 — Tonight freshness contract

- **Goal:** Stop presenting request time as source freshness.
- **Branch:** `fix/tonight-freshness-contract`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-tonight-freshness`
- **Owned files/seams:** Store, mapper, handler, API response, freshness tests.
- **Excluded:** Grouping and UI.
- **Dependencies:** `S00`, `S01`.
- **Base-SHA rule:** Exact reviewed SHAs.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** None for honest freshness and ended filtering.
- **Tasks:** Three-state freshness; aggregate source time; ended-row filtering; London service boundaries; wire canonical grouping pipeline before final API limit; never forward user-requested final limit to live provider before grouping.
- **Deterministic tests:** 03:59/04:00, BST gaps/repeats, `endsAt === now`, missing ends, provider timestamp absent, dataset timestamp, unknown, provider inventory larger than final limit, and group-before-limit. Rerun pipeline tests after every L14 grouping change.
- **Browser proof:** Stubbed API displays unknown rather than current time.
- **Rollback:** Keep honest freshness split and ended filtering; only additive response fields may remain unused.
- **Review receipt:** `RR-L13`, frozen-clock fixtures.
- **Done:** `servedAt` never reaches source freshness label.

### L14 — Tonight grouping and locality model

- **Goal:** Deterministic local variety before API limit.
- **Branch:** `feat/tonight-grouping-locality`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-tonight-grouping-locality`
- **Owned files/seams:** Adopt and harden shipped `lib/tonightListGrouping.ts`, related pure grouping/locality helpers, and `lib/tonight.ts`. Never create a parallel grouping implementation.
- **Excluded:** Tonight component/CSS.
- **Dependencies:** `S13`.
- **Base-SHA rule:** `B1 + S13`.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flag:** Gates V2 server locality, diversity, and canonical grouped-response behavior only. Shipped chain-duplicate collapse remains in safe off state.
- **Upstream baseline:** Preserve nearest hero, alternates, expander-compatible shape, and family facets while moving canonical authority server-side.
- **Tasks:** Add normalized schedule to exact group key; preserve distinct source and distinct schedule; family diversity; locality; nearest hero; borough centroids; stable distance/confidence/source-observation/start/family/Venue tie-break; alternatives exactly once.
- **Deterministic tests:** Case/punctuation, distinct source, distinct schedule, 60-chain fixture, equal/missing distances, first-ten cap, every alternate once, V2 flag off/on, and stable exact order.
- **Browser proof:** Fixed 60-row fixture returns varied first ten in exact order.
- **Rollback:** Disable V2 server locality/diversity response only; retain hardened chain-duplicate collapse, honest freshness, and ended filtering.
- **Review receipt:** `RR-L14`, exact ordered fixture output.
- **Done:** Grouping occurs before limit and produces stable order.

### L15 — Tonight trusted UI and acceptance

- **Goal:** Show current, local, varied Tonight results and preserve accepted source.
- **Branch:** `feat/tonight-trusted-ui`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-tonight-trusted-ui`
- **Owned files/seams:** Tonight client/CSS and secondary lanes.
- **Excluded:** Store/group algorithms.
- **Dependencies:** `S02`, `S03`, `S05`, `S06`, `S14`.
- **Base-SHA rule:** Exact reviewed commits.
- **Roles:** Implementer `high`; verifier `high`; reviewer `high`.
- **Feature flags:** V2 Tonight server grouping and intent write.
- **Upstream baseline:** Preserve shipped grouped-card expander, nearest hero, family-count facets, and `tonightDedup.css` behavior.
- **Tasks:** Replace client-authoritative grouping with canonical server-group consumption; main-list-first layout; honest labels; per-card freshness; grouped expansion; separate raw inventory count from grouped-card facet count; **Use this Venue**; fixed analytics; contrast.
- **Deterministic tests:** Frozen API, non-London browser timezone, exact ordering/counts, raw-versus-grouped counts, empty/thin state, acceptance URL.
- **Browser proof:** No conditional skips; first ten exact; no ended rows; accepted Tonight Venue arrives as source `tonight`.
- **Rollback:** Disable V2 server grouping and acceptance writer separately; retain shipped chain collapse and honest freshness.
- **Review receipt:** `RR-L15`, UI ordering, axe, and acceptance-source evidence.
- **Done:** Secondary lanes neither duplicate fetch nor dominate first viewport.

### L16 — Narrow Pub Pal locality and handoff

- **Goal:** Fix locality and dead-end behavior without expanding Pal.
- **Branch:** `fix/pal-locality-handoff`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-pal-locality-handoff`
- **Owned files/seams:** Pal chat client, concierge context/API, vibe handoff, Pal-local navigation/back behavior.
- **Excluded:** Memory, voice, personas, broad grounding, new Pal capabilities, `SiteNav.tsx`, `SiteNavMore.tsx`, and `siteNav.css`.
- **Dependencies:** `S02`, `S03`, `S06`, `S14`, `S15`.
- **Base-SHA rule:** Exact reviewed commits.
- **Roles:** Implementer `medium`; verifier `medium`; reviewer `high`.
- **Feature flag:** Pal handoff.
- **Upstream baseline:** Desktop Pal reachability through `SiteNavMore` and mid-width command palette is already shipped. Preserve Pal link, Escape dismissal, and arrow-key behavior without editing shared navigation files.
- **Tasks:** Explicit-query area precedence; remembered fallback; honest London-wide copy; distance/walk evidence; provenance; Pal-local back path; acceptance action.
- **Deterministic tests:** Brixton beats remembered Soho; area-less uses Soho; no context becomes London-wide; missing distance honest; existing More-menu Pal link and keyboard behavior remain.
- **Browser proof:** Every card has provenance; accepted Pal Venue reaches Map with source `pal`; existing navigation remains keyboard reachable.
- **Rollback:** Disable Pal handoff; existing Pal remains.
- **Review receipt:** `RR-L16`, query/context precedence cases.
- **Done:** No distant result described as local without evidence.

### L17 — Map search no-results

- **Goal:** Make misses visible, announced, and private.
- **Branch:** `fix/map-search-no-results`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-map-search-no-results`
- **Owned files/seams:** Search component/CSS and tests.
- **Excluded:** Map history, canvas, ranking.
- **Dependencies:** `S01`, `S02`.
- **Base-SHA rule:** Exact reviewed SHAs.
- **Roles:** Implementer `medium`; verifier `medium`; reviewer `high`.
- **Feature flag:** None; safety/accessibility fix.
- **Tasks:** Persistent listbox; polite status; single announcement; clear action; examples; no-query analytics.
- **Deterministic tests:** Zero/one/many results, Enter, Escape, clear, announcement count, no query prop.
- **Browser proof:** Keyboard focus remains valid at both viewports.
- **Rollback:** Revert scoped component only.
- **Review receipt:** `RR-L17`, live-region and analytics request evidence.
- **Done:** Miss is visible and announced once.

### L18 — Map renderer and console health

- **Goal:** Remove invalid expression and style reload burst.
- **Branch:** `fix/map-render-console-health`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-map-render-console-health`
- **Owned files/seams:** Canvas filters, map canvas, strict console specs.
- **Excluded:** Map selection/history and search UI.
- **Dependencies:** `S01`.
- **Base-SHA rule:** `B1 + S01`.
- **Roles:** Implementer `medium`; verifier `high`; reviewer `high`.
- **Feature flag:** None; renderer correctness.
- **Tasks:** Top-level zoom interpolation; selected multiplier inside outputs; narrow console allowlist; repeated-request bound.
- **Deterministic tests:** Expression structure and selected/unselected outputs.
- **Browser proof:** SwiftShader GL plus no-WebGL fallback; no tile burst, invalid icon-size, warning, blank frame, or reload loop.
- **Rollback:** Remove selected multiplier while retaining safe base expression and selection glow.
- **Review receipt:** `RR-L18`, GL/no-GL traces and console logs.
- **Done:** Exact named production warning cannot pass allowlist.

### L19 — Landing Find my pint hierarchy

- **Goal:** Make trusted pint entry dominant after handoff works.
- **Branch:** `feat/landing-find-my-pint`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-landing-find-my-pint`
- **Owned files/seams:** Landing component/CSS and landing specs.
- **Excluded:** Stories, Pub Pal, city expansion, new content.
- **Dependencies:** `S00`, `S01`, `S02`, `S06`, `S11`.
- **Base-SHA rule:** Exact reviewed commits.
- **Roles:** Implementer `low`; verifier `medium`; reviewer `high`.
- **Feature flag:** Landing hierarchy.
- **Upstream baseline:** `PintDropStrip` empty/hung fail-soft behavior is already shipped. Preserve its eight-second fail-soft path.
- **Tasks:** One primary CTA; Map secondary; direct Plan available but lower weight; remove repeated equal-weight mobile CTA pairs; scoped contrast. Do not rework solved Pint Drop fail-soft behavior.
- **Deterministic tests:** Link targets, one primary action, no hidden Map/Plan, and eight-second Pint Drop fail-soft regression.
- **Browser proof:** CTA above fold at 390×844 and 1440×900, light/dark/reduced motion; empty/hung Pint Drop never blocks landing.
- **Rollback:** Disable landing flag independently.
- **Review receipt:** `RR-L19`, screenshot matrix and contrast ratios.
- **Done:** Core handoff already passes before this lane activates.

### L20 — Integration assembly

- **Goal:** Assemble reviewed commits without introducing new code.
- **Branch:** `integration/trusted-pint-to-crew`
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-trusted-pint-to-crew-integration`
- **Owned files/seams:** None.
- **Excluded:** Manual product code, conflict resolution, test authoring, cleanup refactors.
- **Dependencies:** Exact approved set of `S00` through `S19`.
- **Base-SHA rule:** Start from B1; cherry-pick reviewed SHAs in DAG order.
- **Roles:** Assembler `medium`; verifier `high`; reviewer `high`.
- **Feature flag:** Full all-off and staged-on matrices.
- **Tasks:** Start from revalidated `B1`; cherry-pick reviewed lane commits only; record order; stop on conflict; run complete gates. Never cherry-pick upstream commits already absorbed into `B1`.
- **Deterministic tests:** Full unit and state matrices; flag mismatches; legacy migration; operation replay; upstream SiteNav/Pal, DesktopRail, map-banner staging, Tonight grouping, Near shell, Plan CTA token, activity/profile, messages, and landing fail-soft regressions.
- **Browser proof:** Full journey, GL/no-GL, axe, privacy, visual, performance, plus upstream desktop rail/navigation regression matrix.
- **Rollback:** Drop integration worktree. No source rollback needed because no push/merge.
- **Review receipt:** `RR-L20`, reviewed SHA list and confirmation no manual source edits.
- **Done:** Clean worktree, full evidence, no unresolved critical/high, no push.

---

## 10. Browser and state verification matrix

### Business-state matrix

Run fixed fixtures at both `390×844` and `1440×900`:

1. Clean storage, signed out.
2. Valid restored PlanningIntent.
3. Expired PlanningIntent.
4. Malformed PlanningIntent.
5. Oversized PlanningIntent.
6. Unsupported intent version.
7. Legacy Plan draft.
8. Legacy Route draft.
9. Existing newer Plan draft.
10. Existing Route draft.
11. Consent granted.
12. Consent denied.
13. DNT enabled.
14. Storage read/write/remove throws.
15. Grounding proof expires before lock.
16. Idempotent replay, same payload.
17. Idempotent replay, changed payload.
18. Valid one-Stop Plan.
19. Valid three-Stop Plan.
20. Revoked, expired, malformed, and wrong-Plan capability.

Core journey:

```text
/near
  -> Use this Venue
  -> /map selected receipt
  -> Make it Stop 1
  -> /plan seeded context
  -> route | anchor-only | anchor-conflict
  -> lock Plan
  -> anonymous Friend preview
  -> name-only join
  -> full member Route
```

Assertions:

- Exact Venue preserved.
- Exact accepted area preserved.
- Exact London date preserved.
- Exact source type preserved.
- Exact source freshness kind preserved.
- No repeated area/date question.
- No duplicate generation.
- Anchor stays Stop 1.
- No fabricated Stop.
- No tour on explicit/restored arrival.
- Later clean Map remains tour-eligible.
- Back closes sheet, then leaves Map.
- Focus restores correctly.
- One-Stop Plan retains identity when upgraded.
- Anonymous payload contains no Route.
- Full Route appears only after capability.
- Analytics absent without consent or under DNT.
- Analytics payload fixed and sanitized with consent.
- Generation/create/join request counts exact.
- No skipped conditional assertion.

### Presentation matrix

Run every required surface in eight combinations:

| Viewport | Theme | Motion |
|---|---|---|
| 390×844 | light | normal |
| 390×844 | light | reduced |
| 390×844 | dark | normal |
| 390×844 | dark | reduced |
| 1440×900 | light | normal |
| 1440×900 | light | reduced |
| 1440×900 | dark | normal |
| 1440×900 | dark | reduced |

Surfaces:

- Landing.
- Near result and acceptance.
- Selected Map sheet.
- Map search miss.
- Plan intake summary.
- One-Stop Plan.
- Three-Stop Route.
- Anonymous Friend preview.
- Post-join Route.
- Tonight grouped list.
- Pal result.
- Map GL and fallback state.

### Anonymous privacy scan

Before hydration:

- Fetch raw `/plan/[id]` HTML.
- Scan forbidden Venue names and IDs.
- Scan serialized script data.
- Capture every `text/x-component` RSC response.
- Scan anonymous `/api/plans/[id]`.
- Scan `/api/plans/[id]/getin`.
- Scan `/api/plan-card`.
- Scan `/plan/[id]/recap`.
- Assert Route geometry, Stop order, Venue details, full context, and crew list absent.
- Join.
- Restore capability.
- Assert exact Route appears.
- Revoke capability.
- Assert preview-only state returns.

---

## 11. Exact verification commands

L01 must update Playwright config so `PW_NEXT_DIST_DIR` controls E2E build directory.

Per lane:

```bash
npm ci

NEXT_DIST_DIR=.next-ci-LXX npm run ci:isolated

PW_NEXT_DIST_DIR=.next-pw-LXX \
PW_PORT=31XX \
npx playwright test <lane-specs> \
  --project=chromium \
  --workers=1 \
  --reporter=json \
  > artifacts/LXX-playwright.json

node scripts/assert-playwright-gate.mjs \
  artifacts/LXX-playwright.json \
  --require-zero-skipped \
  --report-retries

node scripts/assert-no-conditional-e2e-skips.mjs e2e
```

Accessibility:

```bash
PW_NEXT_DIST_DIR=.next-axe-LXX \
PW_PORT=32XX \
npx playwright test e2e/accessibility-gates.spec.ts \
  --project=chromium \
  --workers=1 \
  --reporter=json \
  > artifacts/LXX-axe.json

node scripts/assert-playwright-gate.mjs \
  artifacts/LXX-axe.json \
  --require-zero-skipped
```

Privacy:

```bash
PW_NEXT_DIST_DIR=.next-privacy-LXX \
PW_PORT=33XX \
npx playwright test e2e/plan-privacy-boundary.spec.ts \
  --project=chromium \
  --workers=1 \
  --reporter=json \
  > artifacts/LXX-privacy.json

node scripts/assert-playwright-gate.mjs \
  artifacts/LXX-privacy.json \
  --require-zero-skipped
```

GL and fallback:

```bash
PW_NEXT_DIST_DIR=.next-gl-LXX \
PW_PORT=34XX \
npx playwright test \
  e2e/map-gl.spec.ts \
  e2e/map-console-health.spec.ts \
  --project=chromium-gl \
  --workers=1

PW_NEXT_DIST_DIR=.next-no-gl-LXX \
PW_PORT=35XX \
npx playwright test \
  e2e/map-fallback.spec.ts \
  --project=chromium-no-gl \
  --workers=1
```

Visual matrix:

```bash
PW_NEXT_DIST_DIR=.next-visual-LXX \
PW_PORT=36XX \
npx playwright test e2e/trusted-handoff-visual.spec.ts \
  --project=chromium \
  --workers=1 \
  --reporter=json \
  > artifacts/LXX-visual.json
```

State matrix:

```bash
PW_NEXT_DIST_DIR=.next-state-LXX \
PW_PORT=37XX \
npx playwright test e2e/trusted-handoff-state-matrix.spec.ts \
  --project=chromium \
  --workers=1 \
  --reporter=json \
  > artifacts/LXX-state.json
```

Performance:

```bash
PUBMAX_PERF_SAMPLES=5 \
PW_NEXT_DIST_DIR=.next-perf-LXX \
PW_PORT=38XX \
npx playwright test e2e/trusted-handoff-performance.spec.ts \
  --project=chromium \
  --workers=1 \
  --reporter=json \
  > artifacts/LXX-performance.json
```

Full integration:

```bash
npm ci

NEXT_DIST_DIR=.next-ci-integration npm run ci:isolated

PW_NEXT_DIST_DIR=.next-pw-integration \
PW_PORT=39001 \
npx playwright test \
  --workers=1 \
  --reporter=json \
  > artifacts/integration-playwright.json

node scripts/assert-playwright-gate.mjs \
  artifacts/integration-playwright.json \
  --require-zero-skipped \
  --report-retries

git status --short
```

`git status --short` must be empty after tracked generated files are restored. No receipt may claim clean build otherwise.

---

## 12. Quality gates

### Accessibility

- Zero critical or serious axe findings.
- Body text at least 4.5:1.
- Large text and UI boundaries at least 3:1.
- No color-only state.
- Mobile targets at least 44×44.
- Search miss announced exactly once.
- Tour and full sheet focus traps correct.
- Focus returns to invoking control.
- Reduced motion removes ambient/route/sheet flourish without hiding state.

### Console and network

Fail on:

- Any console error.
- Any unexpected warning.
- React warning.
- Hydration warning.
- Accessibility warning.
- Invalid `icon-size`.
- `tile failure burst`.
- Unexpected same-origin 4xx/5xx.
- Repeated style/tile requests above defined bound.
- Duplicate generation.
- Anonymous Route leakage.

Only exact single service-worker update information message may remain allow-listed.

### Performance

For each viewport:

- Five cold samples.
- Five warm samples.
- Report median and p75.
- LCP no worse than 2.5 seconds.
- CLS no worse than 0.1.
- INP no worse than 200 ms after real interaction.
- Useful Map state no worse than 3 seconds p75.
- Record eager decoded JS size.
- No new eager Stories or broad Pal bundle.

### Flake and skip policy

- Zero skipped tests.
- No conditional “quiet data” return.
- Every browser data dependency uses fixed fixture.
- Every time-dependent test freezes clock.
- Every Tonight E2E stubs `/api/whats-on`.
- London logic tested from UTC, New York, and Tokyo browser timezones.
- Retry count recorded.
- Two identical failures count deterministic.
- Any unexplained retry blocks receipt.

---

## 13. Evidence receipt templates

### Build and test receipt

```markdown
Receipt: BT-LXX
Branch:
Worktree:
Base SHA:
Dependency SHAs:
HEAD SHA:
Node version:
npm version:
Next.js version:
Playwright version:
Chromium version:
Exact commands:
Flags:
Timezone:
Frozen clock:
Exit codes:
Passed:
Failed:
Skipped:
Retried:
Duration:
Artifacts:
Working tree clean:
```

### Browser receipt

```markdown
Receipt: BR-LXX-<scenario>
Scenario:
Initial storage:
Initial URL:
Viewport:
Theme:
Motion:
Expected Venue/area/date/source/Stops:
Actual Venue/area/date/source/Stops:
Generation requests:
Create requests:
Join requests:
Final storage:
Screenshot:
Trace:
Console log:
Network log:
Result:
```

### Privacy receipt

```markdown
Receipt: PR-LXX
Reviewed SHA:
Anonymous HTML scan:
Anonymous RSC scan:
Anonymous API scan:
OG scan:
Get-in scan:
Recap scan:
Forbidden Venue names:
Forbidden Venue IDs:
Route data before join:
Capability transition:
Route data after join:
Revoked capability result:
Expired capability result:
Wrong-Plan capability result:
Result:
```

### Accessibility receipt

```markdown
Receipt: AX-LXX
Reviewed SHA:
Axe JSON:
Critical:
Serious:
Contrast ratios:
Keyboard sequence:
Modal count:
Focus restoration:
Live-region announcement count:
Reduced-motion result:
```

### Performance receipt

```markdown
Receipt: PF-LXX
Reviewed SHA:
Hardware/browser profile:
Viewport:
Cold samples:
Warm samples:
Median LCP/CLS/INP/useful-map:
p75 LCP/CLS/INP/useful-map:
Decoded JS size:
Threshold result:
Artifacts:
```

### Review receipt

```markdown
Receipt: RR-LXX
Implementer identity/model/effort:
Verifier identity/model/effort:
Reviewer identity/model/effort:
Base SHA:
Reviewed HEAD SHA:
Files reviewed:
Critical findings:
High findings:
Medium findings:
Low findings:
Dispositions:
Unresolved risks:
Test receipts:
Privacy/axe/performance receipts:
Confirmation no code changed after review:
Final verdict:
```

### Integration receipt

```markdown
Receipt: IR-L20
B1:
Cherry-pick order:
Reviewed lane SHAs:
Conflicts:
Manual source edits:
Integration HEAD:
Flags-off result:
Producer-only result:
Consumer-only result:
Full-on result:
Legacy migration result:
GL result:
No-GL result:
Privacy result:
Axe result:
Performance result:
Full review receipt:
```

### Deployment receipt for later authorized release

```markdown
Receipt: DR-<stage>
Reviewed SHA:
Candidate deployment ID:
Previous known-good deployment ID:
Active flags:
Preview matrix:
Production smoke:
Domain-resolved deployment ID:
Rollback drill:
Result:
```

---

## 14. Review and revision policy

Every lane follows:

1. Implementer pass.
2. Deterministic tests.
3. Browser proof.
4. Fresh verifier pass by different `gpt-5.6-sol` agent.
5. Revision cycle one if needed.
6. Rerun affected and integration-adjacent gates.
7. Recorded reviewer pass by separate pass.
8. Revision cycle two if needed.
9. Rerun all invalidated receipts.
10. Final recorded review.
11. Send `RR-Lxx` to supervisor; coordinator does not push or open a PR.

Hard rules:

- Maximum two revision cycles.
- Implementer, verifier, and reviewer must be three distinct `gpt-5.6-sol` agents.
- Failure after cycle two returns to owner with evidence.
- No endless agent loop.
- Full recorded review required before any push.
- No unresolved critical or high finding.
- Any post-review code change invalidates review receipt.
- Any post-review code change invalidates affected test, browser, privacy, axe, and performance receipts.
- Formatting-only change still changes SHA and requires reviewer confirmation.
- Coordinator and lane agents stop before push even after clean review; supervisor alone decides push, PR, and merge actions.

---

## 15. Staged release and activation plan

Release remains hypothetical until separate deployment and production authorization is explicitly recorded.

### Stage 0 — Preview candidate, all flags off

- Record reviewed integration SHA.
- Record current known-good production deployment ID.
- Create preview only after separate deployment authorization.
- Run full flags-off matrix.
- Confirm old clients, V1 drafts, and generic paths work.
- Run rollback drill in preview.

### Stage 1 — Mandatory privacy and dormant contracts

Keep optional handoff flags off. After mandatory privacy scans pass, enable `PUBMAX_FRIEND_MEMBER_REHYDRATION_V2=1`; do not expose this stage with preview-only member access.

Ship:

- Anonymous preview projection.
- Capability-aware full-state boundary.
- Analytics registry.
- Verified token support.
- V2 parsers.
- Feature flag registry.
- Tonight honest freshness fields.
- Ended-row filtering.

Gate:

- Anonymous HTML/RSC/API privacy scan.
- Legacy browser matrix.
- Zero core API regressions.

### Stage 2 — Safety fixes

Ship always-on:

- `q` and explicit-intent onboarding suppression.
- Selection history and Back behavior.
- Search no-results.
- MapLibre expression fix.
- Strict console gate.
- Scoped contrast.

Gate:

- Clean/restored Map states.
- GL and no-GL.
- Focus/modal matrix.

### Stage 3 — PlanningIntent producer

Enable:

```text
PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE=1
PUBMAX_TRUSTED_HANDOFF_INTENT_READ=0
```

Ship:

- Explicit Near/Map acceptance.
- Typed source continuity.
- Accepted Map receipt.

Gate:

- Producer-only mismatch.
- Generic Plan unaffected.
- Storage failures remain usable.

### Stage 4 — PlanningIntent consumer

Enable:

```text
PUBMAX_TRUSTED_HANDOFF_INTENT_READ=1
```

Gate:

- Newer and legacy drafts win.
- Intent fills blanks only.
- No repeated area/date questions.
- No silent replacement.

### Stage 5 — Anchored generation and one-Stop lifecycle

Enable:

```text
PUBMAX_ANCHORED_GENERATION=1
```

Gate:

- Route, anchor-only, and conflict fixtures.
- Proof V2.
- One-Stop save and same-ID upgrade.
- Anonymous preview and post-join Route.
- Verified event tokens.

### Stage 6 — Map Route transfer

Enable:

```text
PUBMAX_MAP_ROUTE_TRANSFER=1
```

Gate:

- Exact Route equality.
- Zero second generation.
- Proof and operation key retained.

### Stage 7 — Tonight grouping and trusted UI

Freshness, ended filtering, and shipped schedule-safe chain-duplicate collapse already remain active.

Enable V2 canonical server grouping, locality, and diversity:

```text
PUBMAX_TONIGHT_GROUPING=1
```

Gate:

- Flag-off retains hardened chain collapse without returning 60 near-identical cards.
- 60-chain fixture.
- Distinct schedules and sources remain distinct.
- Group-before-limit.
- First-ten diversity.
- Stable deterministic ordering.
- Locality wording.
- Tonight acceptance continuity.

### Stage 8 — Pal handoff

Enable:

```text
PUBMAX_PAL_HANDOFF=1
```

Gate:

- Explicit query precedence.
- Remembered area.
- Honest London fallback.
- Navigation and acceptance continuity.

### Stage 9 — Landing hierarchy last

Enable:

```text
PUBMAX_LANDING_FIND_MY_PINT=1
```

Gate:

- Core handoff already healthy.
- Above-fold CTA at both viewports.
- Full visual/axe/performance matrix.
- No Map or Plan discoverability regression.

After each stage:

1. Run production smoke only if production action separately authorized.
2. Verify active flags.
3. Verify expected commit SHA.
4. Verify `pubmaxxing.com` resolves to intended deployment ID.
5. Keep previous known-good deployment immediately promotable.
6. Stop on any automatic rollback trigger.

---

## 16. Exact rollback order

Rollback optional features in this order:

1. Disable `PUBMAX_LANDING_FIND_MY_PINT`.
2. Disable `PUBMAX_PAL_HANDOFF`.
3. Disable V2 server locality/diversity behavior through `PUBMAX_TONIGHT_GROUPING`; retain hardened chain-duplicate collapse.
4. Keep honest freshness and ended-row filtering active.
5. Disable `PUBMAX_MAP_ROUTE_TRANSFER`.
6. Disable `PUBMAX_ANCHORED_GENERATION`.
7. Keep accepted Venue visible as provisional Stop.
8. Disable `PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE`.
9. Disable `PUBMAX_TRUSTED_HANDOFF_INTENT_READ`.
10. Keep tolerant V1/V2 parsers.
11. Keep anonymous privacy projection.
12. Keep user Plan drafts.
13. Promote last-known-good deployment only with explicit owner authorization.

Immediate stop and rollback triggers:

- Pre-join Venue or Route leak.
- Silent accepted-Venue substitution.
- Anchor not at Stop 1.
- Wrong area or London date.
- Invalid or expired proof accepted.
- Duplicate Plan creation or generation.
- Plan join or creation regression.
- New core API 5xx.
- Blank Map.
- Tile/style reload loop.
- New serious or critical axe result.
- Analytics contains location, identity, query, URL, capability, or Friend data.
- LCP above 2.5 seconds.
- INP above 200 ms.
- Domain deployment ID differs from reviewed candidate.

Privacy rollback rule:

- Never restore anonymous full `PlanState`.
- If member rehydration fails, turn it off and serve privacy preview to everyone.
- Privacy safety outranks full Route availability.

---

## 17. Active execution lock

- Owner returned on **2026-07-24** and authorized completion of remaining tasks.
- Owner selected native `gpt-5.6-sol` agents, overriding prior `claudex` transport requirement.
- Owner authorized full-DAG overnight execution through isolated worktrees and local commits.
- Coordinator never implements; implementer, verifier, and reviewer remain separate subagents.
- Supervisor receives `RR-Lxx` after every lane and is sole push, PR, and merge gate.
- Coordinator and lane agents perform no further pushes or PR creation.
- Compact between lane waves.
- Subscription-included execution only. If included subscription allowance ends, stop all new model/agent work immediately; never consume API credits, paid fallback credits, or fallback gateways without fresh explicit owner authorization.
- Never touch `feat/desktop-parity-d3-gazetteer`.
- No Vercel deploy or promotion.
- No domain or production mutation.

---

## 18. Recorded owner authorization

```text
EXECUTE FULL TRUSTED PINT-TO-CREW DAG USING NATIVE SOL SUBAGENTS
COORDINATOR DOES NOT IMPLEMENT
SUPERVISOR OWNS PUSH, PR, REVIEW GATE, AND MERGE
```

Authorization covers isolated implementation lanes, verification, review, and local commits. It excludes coordinator/lane pushes, PR creation, deployment, promotion, and domain changes.
