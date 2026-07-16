# API Contracts — THE LOCAL

Source of truth: **issue #252** ("Spec: The Local — companion-led activation, night areas, late food, and retention OS"). This document is the API contract that the backend agent (Sol) builds against. It reconciles the four Lane‑2 endpoints named in `sol.md` with what the Codex agent already shipped on `origin/codex/pubmaxx-mobile-ui-reset`, and with the existing plans API on `origin/main`.

**Status legend used throughout:**

- **EXISTS-ON-MAIN** — shipped on `origin/main` today.
- **EXISTS-ON-CODEX-BRANCH** — built on `origin/codex/pubmaxx-mobile-ui-reset`, not yet merged to main.
- **TO-BUILD** — required by #252 / `sol.md` but not implemented anywhere yet.

**The four Lane-2 endpoints** (`sol.md`) and their reconciled reality:

| `sol.md` name | Reality | Status |
| --- | --- | --- |
| `POST /api/plans/generate` | Built by Codex as `POST /api/plans/generate` (NOT `/api/companion/recommend` from #252) | EXISTS-ON-CODEX-BRANCH |
| `PATCH /api/plans/:id` | Built by Codex (adds `status`, `context`, `stops` route replacement) | EXISTS-ON-CODEX-BRANCH |
| `POST /api/plans/:id/actions` | Built by Codex (arrived / skipped / swapped) | EXISTS-ON-CODEX-BRANCH |
| `GET /api/night-areas/:slug` | Built by Codex, plus `GET /api/night-areas?city=` from #252 | EXISTS-ON-CODEX-BRANCH |

Adjacent endpoints Codex also built and this contract now governs: `POST /api/plans/:id/complete`, `GET /api/late-food`.

---

## 0. Reconciliation summary — read this first

These are the places where Codex's implementation diverges from #252 or `sol.md`. Each has a recommended "which side wins" call for the owner.

1. **Endpoint naming: `/api/plans/generate` vs #252's `/api/companion/recommend`.**
   #252's Implementation Decisions literally say `POST /api/companion/recommend`. Codex shipped `POST /api/plans/generate` instead, matching `sol.md`. **Recommendation: `sol.md` / Codex wins** — `/api/plans/generate` is already built and tested; treat `/api/companion/recommend` as a superseded alias in #252. Do not build a parallel companion route.

2. **Error envelope is inconsistent and mostly NOT the shared `apiError` shape.** `sol.md` requires "shared apiError shape on every new public route." `lib/apiError.ts` defines the canonical shape `{ error: { code, message, status } }`. But every new route (generate, PATCH, actions, complete, night-areas, late-food) returns the legacy flat shape `{ error: "human string" }` via `jsonNoStore`. Only ONE code path — generate's `409 NIGHT_AREA_ROUTE_NOT_READY` — returns a structured `{ error: { code, message } }` object (and even that omits `status` and adds sibling fields). **Recommendation: #252/`sol.md` wins — this is the single biggest required delta.** See §7. Every public route in THE LOCAL must adopt `apiError(code, message, status)`.

3. **Rate limits missing on two of the four routes.** `sol.md` requires rate limits "on every new public route." `POST /api/plans/generate` has one; `GET /api/night-areas` (both variants) and `GET /api/late-food` have NONE. **Recommendation: TO-BUILD** rate limits on the two GET routes (see §6).

4. **`plan-generate` durable rate-limit key is a global constant, not per-IP.** In `app/api/plans/generate/route.ts` the local key is `plan-generate:${hashIp(...)}` (per-IP) but the durable key is the literal string `"plan-generate"` (shared across ALL callers). Under Supabase this throttles the whole world against one 8/60s budget. **Likely a bug — open question for owner.** Should be `plan-generate:${hashIp(...)}` for both.

5. **Analytics vocabulary diverges from #252's registry.** #252 mandates a named set (`activation_started`, `area_selected`, `companion_selected`, `recommendation_returned`, `recommendation_accepted`, `plan_shared`, `plan_joined`, `late_food_viewed`, `late_food_added`, …). Codex instead added its own names (`night_description_submitted`, `planned_night_status_changed`, `planned_night_action`, `planned_night_completed`, `pub_pal_adopted`, `plan_invite_sent`, `plan_invite_opened`, `crew_committed`, `district_viewed`, …). **Open question: which registry wins?** See §8.

6. **"Companion" is shipped as "Pub Pal."** #252 says "companion" and `POST /api/companion/recommend`. Codex shipped the persona system as **Pub Pal** (`lib/pubPal.ts`, `app/api/pub-pal/*`). Same concept, different surface name. Contract treats them as synonyms; owner should pick one product noun.

7. **Late-food is static/editorial, ignores `at=`, covers 6 of 20 areas.** #252 wants open-at-requested-time ranking, FSA hygiene evidence, coordinates, and route-home compatibility. Codex shipped an honest static seed that explicitly labels `live_opening_hours`, `hygiene_rating`, and `terminal_coordinates` as `missingEvidence`, accepts but ignores `at=`, and only seeds `clapham, victoria, piccadilly-soho, canary-wharf, barnes, chiswick`. **Recommendation: Codex's honest static seed is acceptable for Phase 1/2; the full ranking is TO-BUILD** and must keep the "unknown hours are labelled, not assumed" invariant.

8. **`GET/PUT /api/me/night-profile` is not built.** #252 requires durable authenticated night-profile persistence. Codex persists `NightContext` on the Plan row (`night_context`) and has a Pub Pal store, but no `/api/me/night-profile`. **Status: TO-BUILD** (see §9). Anonymous profile lives client-side only, per #252.

---

## 1. Shared conventions

### 1.1 Auth model — keyless-first + member-token

THE LOCAL follows the existing plans pattern: **value before sign-in.** There is no API key and no required account for the core loop.

- **Public read** (`GET /api/plans/:id`, `/getin`, `/complete`, `/api/night-areas*`, `/api/late-food`): no auth. Link-visibility only — anyone with the Plan id can read it. EXISTS-ON-MAIN pattern.
- **Create** (`POST /api/plans`, `POST /api/plans/generate`): keyless. On a write, the server mints an opaque **member token** (`memberToken`, returned once in the create/join response body; the server stores only its salted SHA‑256 hash). EXISTS-ON-MAIN.
- **Member-scoped writes** (`PATCH /api/plans/:id`, `POST /api/plans/:id/actions`, `POST /api/plans/:id/complete`, `POST /api/plans/:id/presence`): require the caller to present their member token, proving they belong to the crew.
  - Canonical transport: `Authorization: Bearer <memberToken>` header. Body field `memberToken` is accepted as a migration fallback. Helper: `lib/planMemberCapability.ts` (`planMemberCapability(request, body.memberToken)`). EXISTS-ON-CODEX-BRANCH.
  - **Divergence:** `POST /api/plans/:id/actions` reads only `body.memberToken` and does NOT use the `planMemberCapability` header helper. **Recommendation: TO-BUILD — align actions to accept the Bearer header** like PATCH/complete.
- **Authenticated profile** (`/api/me/night-profile`, TO-BUILD): Supabase Auth session (existing consumer identity provider; #252 keeps Supabase, reserves WorkOS for later Work Nights).

The member token is never logged or serialised back after the initial mint (`planMemberCapability` comment; `planStore` stores `token_hash` only).

### 1.2 Response caching

All THE LOCAL routes are `Cache-Control: no-store` (both `jsonNoStore` and `apiError` default to `no-store`). EXISTS-ON-MAIN.

### 1.3 City scoping

`cityId` is validated by `parseCityId` (`lib/cities.ts`); `DEFAULT_CITY_ID = "london"`. A Night Area belongs to exactly one city; generate returns `422` if the selected area's `cityId` ≠ the request `cityId`. EXISTS-ON-CODEX-BRANCH.

---

## 2. Core lifecycle types (per #252 TL-1)

Defined in `lib/nightPlanning.ts` and `lib/plan.ts` on the Codex branch. **Status: EXISTS-ON-CODEX-BRANCH** unless noted.

### 2.1 NightContext + Daypart

```ts
// lib/nightPlanning.ts
export const DAYPARTS = ["daytime", "after_work", "evening", "late_night", "get_home"] as const;
export type Daypart = (typeof DAYPARTS)[number];

export const PARTY_TYPES = ["solo", "friends", "work"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const BUDGETS = ["value", "standard", "treat"] as const;
export type Budget = (typeof BUDGETS)[number];

export type NightAreaSlug =
  | "clapham" | "victoria" | "piccadilly-soho" | "canary-wharf" | "barnes" | "chiswick"
  | "shoreditch" | "camden" | "brixton" | "bermondsey-london-bridge" | "kings-cross" | "islington"
  | "dalston" | "peckham" | "greenwich" | "hammersmith" | "balham" | "marylebone" | "richmond" | "putney";

export type NightContext = {
  nightArea: NightAreaSlug | null;
  daypart: Daypart;
  partyType: PartyType;
  groupSize: number | null;      // 1..30, floored
  budget: Budget;
  atmosphere: string[];          // e.g. ["quiet","lively","historic","cosy","sports","music"], max 8 short strings
  foodNeeds: string[];           // e.g. ["kebab","pizza","chips","vegan","vegetarian","halal"]
  accessibility: string[];       // e.g. ["step-free"]
  transportConstraints: string[];// e.g. ["tube","walking"]
};

// Attribution of *why* the inferred context looks the way it does:
export type ContextReason = { field: keyof NightContext; evidence: string; explanation: string };
export type InferredNightContext = { context: NightContext; confidence: number; reasons: ContextReason[] };
```

Validators/parsers (server-owned, reuse — do not fork): `inferNightContext(query, now?)`, `cleanNightContext(value)` (strict: requires area+daypart+partyType+budget), `cleanNightContextPatch(value)` (partial merge), `isNightAreaSlug`, `isDaypart`, `isPartyType`, `isBudget`.

### 2.2 PlannedNight lifecycle

```ts
// lib/plan.ts
export const PLANNED_NIGHT_STATUSES = ["draft", "ready", "active", "ending", "completed", "abandoned"] as const;
export type PlannedNightStatus = (typeof PLANNED_NIGHT_STATUSES)[number];

// Legal transitions (canTransitionPlannedNight): identity always allowed, plus:
//   draft   → ready | abandoned
//   ready   → draft | active | abandoned
//   active  → ending | completed | abandoned
//   ending  → active | completed | abandoned
//   completed → (terminal)
//   abandoned → (terminal)

export type CrawlEnding = "food" | "get_home" | "keep_going";

export type PlanActionDTO = {
  id: string;
  type: "arrived" | "skipped" | "swapped" | "ending";
  stopPosition: number | null;
  ending: CrawlEnding | null;
  createdAt: string;
};
```

### 2.3 Plan DTOs

```ts
// lib/plan.ts
export type PlanDTO = {
  id: string;
  title: string;
  startTime: string;      // ISO
  createdAt: string;      // ISO
  routeRevision?: number | string; // incremented ONLY when the ordered route is replaced; legacy = 1
  status?: PlannedNightStatus;     // legacy records default to "draft"
};

export type PlanStopDTO = { venueId: string; venueName: string; position: number };

export type PlanState = {
  plan: PlanDTO;
  stops: PlanStopDTO[];
  crew: CrewMemberDTO[];        // { id, name, status, joinedAt, updatedAt } — see lib/crew
  context?: NightContext | null;
  actions?: PlanActionDTO[];
  ending?: CrawlEnding | null;
};

export type PlanCompletionDTO = {
  id: string;
  planId: string;
  ending: CrawlEnding;
  terminalVenueId: string | null;
  finalPintDropId: string | null;   // always null for now — attaching one is refused (see §5.4)
  routeRevision: number;
  routeSnapshot: PlanStopDTO[];
  completedAt: string;
};
```

`PlanDTO`, `PlanStopDTO`, `PlanState.{plan,stops,crew}` and `isPlanId` are **EXISTS-ON-MAIN**. `routeRevision`, `status`, `CrawlEnding`, `PlanActionDTO`, `PlanCompletionDTO`, `PLANNED_NIGHT_STATUSES`, `canTransitionPlannedNight`, `PlanState.{context,actions,ending}` are **EXISTS-ON-CODEX-BRANCH**.

### 2.4 NightArea catalogue

```ts
// lib/nightAreas.ts
export type CoverageStatus = "discovered" | "captured" | "reviewed" | "route_ready" | "paused";

export type RouteReadyGateCode =
  | "venue_density" | "identity_conflict" | "price_coverage" | "amenity_coverage" | "opening_hours"
  | "transport_anchor" | "route_feasibility" | "terminal_get_home" | "terminal_food"
  | "stale_review" | "unreviewed_source";

export type RecentSignal = {
  id: string; sourceUrl: string; publisher: string; publishedAt: string; claim: string;
  confidence: number; reviewStatus: "reviewed"; expiresAt: string;
};

export type GateCheck = {
  code: RouteReadyGateCode; required: boolean; passed: boolean;
  observed: number | string | null; threshold?: number | string; evidenceRefs: string[];
};
export type NightAreaGate = { version: 1; passed: boolean; checks: GateCheck[] };

export type NightArea = {
  slug: NightAreaSlug;
  cityId: CityId;
  name: string;
  aliases: string[];
  centre: { lat: number; lng: number };
  radiusKm: number;
  transportAnchors: string[];
  demandWave: 0 | 1 | 2 | 3;
  description: string;
  daypartGuidance: Record<Daypart, string>;
  recentSignals: RecentSignal[];            // currently seeded empty
  coverageStatus: CoverageStatus;
  coverageScore: number;
  routeReadyReasons: RouteReadyGateCode[];
  missingEvidence: RouteReadyGateCode[];
  gate: NightAreaGate;
  lastReviewedAt: string | null;
  reviewExpiresAt: string | null;
};
```

Catalogue is **reviewed application data**, not inferred at request time (per #252). `validateNightAreaCatalogue` runs at import (unique slugs/aliases, valid coords, ≥1 transport anchor). `isNightAreaRouteReady(area, now?)` enforces the full route-ready gate + review freshness. **Status: EXISTS-ON-CODEX-BRANCH.** All 20 #252 London areas are seeded; only wave‑0 areas (`clapham`, `victoria`, `piccadilly-soho`, `canary-wharf`) are `route_ready`.

---

## 3. `POST /api/plans/generate` — grounded Plan generation

**Status: EXISTS-ON-CODEX-BRANCH.** (This is `sol.md`'s `/api/plans/generate`; supersedes #252's `/api/companion/recommend`.)

Keyless. Produces a grounded three-stop draft route from a Night Area + NightContext, with per-stop reasons and explicit context attribution. Does **not** persist a Plan — it returns a draft the client can then create/save via `POST /api/plans`.

### Request

```ts
type GeneratePlanRequest = {
  cityId?: string;              // default "london"; validated by parseCityId
  query?: string;              // free-text night description; parsed by inferNightContext
  context?: Partial<NightContext> | NightContext; // merged over inference; MUST resolve a nightArea
};
// At least one of `query` or `context` is required.
```

Merge rule (`mergeContext`): a complete `cleanNightContext` wins; else a `cleanNightContextPatch` is layered over the inferred context; else the inferred context is used. `context.nightArea` must resolve — a `null` area is a `422`.

### Response `200`

```ts
type GeneratePlanResponse = {
  inferredContext: NightContext;        // the merged context actually used
  confidence: number;                   // 0.62 (no area match) .. 0.86 (area matched in text)
  explanations: ContextReason[];        // { field, evidence, explanation }[] — WHY the context was inferred
  stops: Array<{
    venueId: string;
    venueName: string;
    position: number;                   // 0..2
    reason: string;                     // per-stop grounded reason (distance + up to 2 context reasons)
    alternatives: Array<{ venueId: string; venueName: string }>; // next-best swaps
  }>;
  contextEffects: string[];             // WHICH NightContext fields affected ranking:
                                        //   always ["budget","daypart"], plus conditionally
                                        //   "groupSize","partyType","atmosphere","foodNeeds"
  missingContextEvidence: string[];     // data we could not honour: e.g.
                                        //   "venue_accessibility","per_venue_transport","food_terminal_specificity"
  relevantSignals: RecentSignal[];      // area.recentSignals (reviewed only)
};
```

**"Explains which context values affected the result" (#252 requirement — SATISFIED):** three complementary fields — `contextEffects` (the list of NightContext fields that moved the ranking), per-stop `reason` (human-readable grounding per venue), and `explanations` (why the context was inferred). `missingContextEvidence` is the honest counterpart: constraints the engine could not yet ground.

### Errors (current Codex behaviour — see §7 for required envelope migration)

| Status | Condition | Current body |
| --- | --- | --- |
| `400` | malformed JSON | `{ error: "Malformed request body." }` |
| `400` | neither `query` nor `context` | `{ error: "Describe the night or provide Night Context." }` |
| `400` | invalid `cityId` | `{ error: "cityId is invalid." }` |
| `422` | no `nightArea` resolved | `{ error: "Choose a Night Area." }` |
| `422` | area not in requested city | `{ error: "The selected Night Area is not available in this city." }` |
| `422` | fewer than 3 grounded venues in radius | `{ error: "Not enough grounded venues are available in <Area> yet." }` |
| `429` | rate limited | `{ error: "Too many requests." }` |
| `409` | area not route-ready | `{ error: { code: "NIGHT_AREA_ROUTE_NOT_READY", message }, nightArea: {…coverage}, district: {…coverage} }` |

The `409` returns `publicNightAreaCoverage(area)` under both `nightArea` (new) and `district` (back-compat alias). This is the **only** route already emitting a structured error `code`.

### Rate limit

`plan-generate` scope, default budget **8 requests / 60s** (`isLimited` defaults). **BUG (open question):** durable key is the constant `"plan-generate"` (global), local key is per-IP — see §0.4.

### Idempotency

Non-idempotent but side-effect-free: it persists nothing, so retries are safe.

### Keyless-mode behaviour

Fully keyless. No token minted (persistence happens later on `POST /api/plans`).

### Analytics

Emit `night_description_submitted { area, daypart }` on submit; `recommendation_returned`/`recommendation_accepted` (#252 names) are TO-BUILD or map to Codex's `discovery_viewed` — see §8.

---

## 4. `PATCH /api/plans/:id` — revise a Planned Night

**Status: EXISTS-ON-CODEX-BRANCH.** Member-scoped. One of three mutations (never combined in a way that conflicts):

### Request

```ts
type PatchPlanRequest = {
  memberToken?: string;              // fallback if no Authorization: Bearer header
  status?: PlannedNightStatus;       // must be a legal transition from current status
  context?: NightContext;            // full context (strict cleanNightContext)
  stops?: Array<{ venueId: string }>;// EXACTLY 3 distinct Venue Dataset ids → canonical route replacement
  expectedRouteRevision?: number;    // REQUIRED with `stops` — optimistic concurrency
};
```

Rules:
- `stops` replacement requires `expectedRouteRevision` and must NOT be combined with `status`. Stops are re-resolved server-side via `canonicalPlanRoute` (exactly 3 distinct ids that exist in a shipped city dataset; returns canonical names). Replacing the route increments `routeRevision`.
- `context` must pass strict `cleanNightContext` or `400`.
- At least one of `status` / `context` / `stops` must be present.
- `status` change is rejected if `canTransitionPlannedNight(current, next)` is false (`403`/`400` via store).

### Response `200`

Full `PlanState` (updated).

### Errors (current)

| Status | Condition |
| --- | --- |
| `404` | bad/unknown plan id |
| `400` | malformed body / invalid context / bad stop set / missing revision / nothing to update |
| `403` | member token cannot edit this Plan |
| `409` | `expectedRouteRevision` stale — `"That Crawl Route has changed. Refresh and try again."` |

### Idempotency

Route replacement is **optimistically concurrent** via `expectedRouteRevision` → `409` on mismatch (this is the idempotency/lost-update guard). Status transitions are idempotent (identity transition allowed).

### Rate limit

**TO-BUILD.** No limiter currently on PATCH. `sol.md` requires one on every new public route — recommend `plan-patch:<id>:<ipHash>`.

### Analytics

`planned_night_status_changed { status }` (Codex). #252 equivalent: `recommendation_accepted` on first accept.

---

## 5. `POST /api/plans/:id/actions` — record a stop action

**Status: EXISTS-ON-CODEX-BRANCH.** Member-scoped live tracking.

### Request

```ts
type PlanActionRequest = {
  memberToken: string;          // NOTE: header Bearer NOT read here — see §1.1 divergence
  type: "arrived" | "skipped" | "swapped";  // "ending" is REJECTED here (goes via /complete)
  stopPosition: number;         // integer 0..7
};
```

### Response `201`

Full `PlanState` (with the new action in `actions[]`). Side effect: recording any action moves a `draft`/`ready` plan to `active`.

### Errors (current)

| Status | Condition |
| --- | --- |
| `404` | bad/unknown plan id |
| `400` | malformed body / invalid `type` or `stopPosition` |
| `403` | member token cannot update this Plan |

### Idempotency

Non-idempotent (append-only action log). Each POST inserts a new `PlanActionDTO`.

### Rate limit

**TO-BUILD.** None currently. Recommend `plan-action:<id>:<ipHash>`.

### 5.4 Adjacent: `POST /api/plans/:id/complete` (+ `GET`)

**Status: EXISTS-ON-CODEX-BRANCH.** Terminal transition to a completed Planned Night.

```ts
// POST body
type CompletePlanRequest = {
  memberToken?: string;            // or Authorization: Bearer (planMemberCapability)
  ending: "food" | "get_home" | "keep_going";
  expectedRouteRevision: number;   // required, > 0 — optimistic concurrency
  terminalVenueId?: string;        // required when ending === "food"
  finalPintDropId?: unknown;       // MUST be absent — presence returns 400 (ownership not yet verifiable)
};
```

- `POST` → `{ plan, completion }`. HTTP `201` when newly created, `200` when already completed (**idempotent** via `complete_plan_atomic` returning `already_completed`).
- `GET /api/plans/:id/complete` → `{ completion: PlanCompletionDTO | null }` (public read).
- Errors: `404` unknown plan; `400` invalid/malformed/missing terminal-for-food/`finalPintDropId` present; `403` member cannot complete; `409` route revision changed; `503` store error.
- Completion writes the ending action, completion record, and terminal status atomically (Supabase RPC `complete_plan_atomic`).

**Safety invariant (#252):** the default/encouraged endings are `food` and `get_home`; `keep_going` exists but the product must never frame more drinking as success. Food terminals are late-food places, never pint-price pins (see §10).

---

## 6. `GET /api/night-areas` and `GET /api/night-areas/:slug`

**Status: EXISTS-ON-CODEX-BRANCH.** Keyless read of the reviewed catalogue.

### `GET /api/night-areas?city=<cityId>` (#252 shape)

```ts
// 200
type NightAreasListResponse = {
  cityId: CityId;
  areas: Array<NightArea & { routeReady: boolean }>;
};
```
- `400` if `city` missing/invalid; `404` if no areas for that city.

### `GET /api/night-areas/:slug` (`sol.md` shape)

```ts
// 200
type NightAreaDetailResponse = NightArea & { routeReady: boolean };
```
- `404` if `slug` is not a known `NightAreaSlug` (`isNightAreaSlug`).

### Rate limit

**TO-BUILD** on both. Currently none. Recommend a read limiter (pattern of `lib/roundsReadRateLimit.ts` / `lib/lastRideRateLimit.ts`).

### Error envelope

**TO-BUILD** migration to `apiError` (currently flat `{ error }`).

### Analytics

Codex: `district_catalogue_viewed`, `district_viewed { district, coverageStatus, demandWave }`, `district_route_blocked`, `district_route_ready_selected`, `route_ready_gate_failed`. #252 equivalent: `area_selected`. Prop values for these events are hard-allowlisted to catalogue identifiers/gate codes in `sanitizeEvent`.

### Keyless-mode behaviour

Fully public. Availability counts / coverage are visible without auth so first-time visitors can choose an area before sign-in (#252 "value before sign-in").

---

## 7. Shared error envelope (`apiError`) — REQUIRED migration

**Canonical shape** (`lib/apiError.ts`, EXISTS-ON-MAIN):

```ts
export interface ApiErrorBody { error: { code: string; message: string; status: number } }
export function apiError(code, message, status, init?): Response; // Cache-Control: no-store by default
```

**Reality:** every new THE LOCAL route returns the **legacy** flat shape `{ error: "human string" }` via `jsonNoStore`, EXCEPT generate's `409` which returns a partial `{ error: { code, message } }`. `sol.md` requires the shared shape on every new public route.

**Required deltas (TO-BUILD):**
1. Route all 4xx/5xx on generate, PATCH, actions, complete, night-areas, late-food through `apiError(code, message, status)`.
2. Assign a stable machine `code` per failure (e.g. `MALFORMED_BODY`, `INVALID_CITY`, `NIGHT_AREA_REQUIRED`, `NIGHT_AREA_NOT_IN_CITY`, `INSUFFICIENT_VENUES`, `RATE_LIMITED`, `NIGHT_AREA_ROUTE_NOT_READY`, `PLAN_NOT_FOUND`, `MEMBER_FORBIDDEN`, `ROUTE_REVISION_CONFLICT`, `NIGHT_AREA_NOT_FOUND`, `LATE_FOOD_AREA_UNKNOWN`).
3. Preserve generate's `409` sibling coverage payload (`nightArea` / `district`) as extra fields alongside the standard `error` object, or move it into a documented `details` field — **owner decision**.
4. `late-food` currently returns `{ error, terminals: [] }` on `400`; reconcile with `apiError` (keep `terminals: []` as a `details` convenience if clients rely on it).

Until migrated, clients MUST tolerate both `error: string` and `error: { code, message, status }`.

---

## 8. Analytics events

Registry: `lib/analyticsEvents.ts` (`ANALYTICS_EVENTS`), first-party, low-cardinality, no free-text/handles/coords (dropped by `sanitizeEvent`). **EXISTS-ON-MAIN** framework; new events **EXISTS-ON-CODEX-BRANCH**.

**Codex added (branch reality):** `night_description_submitted {area,daypart}`, `planned_night_status_changed {status}`, `planned_night_action {type}`, `planned_night_completed {ending}`, `pub_pal_adopted {pal}`, `pub_pal_summoned {surface}`, `pub_pal_memory_changed {action,category}`, `discovery_viewed {surface,daypart}`, `plan_invite_sent {channel}`, `plan_invite_opened {source}`, `crew_committed {source,participants}`, `account_claimed {source}`, `social_account_connected {provider,connectionType}`, `night_moment_saved {kind,visibility}`, `night_story_published {contributors,moments}`, `next_night_committed {windowDays,source}`, `draft_recovered {kind,surface}`, `web_vital {metric,value,rating}`, `guest_plan_participated {action}`, plus district events `district_catalogue_viewed`, `district_viewed`, `district_route_blocked`, `district_route_ready_selected`, `route_ready_gate_failed`.

**#252 mandated names (not yet present):** `activation_started`, `area_selected`, `companion_selected`, `preferences_completed`, `recommendation_returned`, `recommendation_accepted`, `plan_shared`, `plan_joined`, `late_food_viewed`, `late_food_added`, `briefing_viewed`, `briefing_opened`, `voice_started`, `recap_viewed`, `return_prompt_opened`.

**Open question (§0.5):** adopt #252's exact registry, keep Codex's vocabulary, or map. Suggested mapping if Codex wins: `activation_started`→`night_description_submitted`, `area_selected`→`district_viewed`, `companion_selected`→`pub_pal_adopted`, `recommendation_accepted`→`planned_night_status_changed`, `plan_joined`→`crew_committed`/`guest_plan_participated`, `recap_viewed`→`night_story_published`.

---

## 9. `GET/PUT /api/me/night-profile` — TO-BUILD

Required by #252 (authenticated durable night profile). **Not implemented on either branch.**

```ts
type NightProfile = {
  companionId: string | null;    // Pub Pal id (fox/black-cat/greyhound/pigeon/badger/corgi) or null (no-companion)
  companionName: string | null;  // user rename
  cityId: CityId;
  nightArea: NightAreaSlug | null;
  budget: Budget;
  atmosphere: string[];
  foodNeeds: string[];
  accessibility: string[];
  transportPreference: string[];
  briefingPreferences: { muteAll?: boolean; mutedAreas?: NightAreaSlug[]; mutedTopics?: string[] };
  voicePreference: "off" | "tts" | "ptt";
  updatedAt: string;
  createdAt: string;
};
```

Contract requirements:
- `GET` requires a Supabase Auth session; returns the caller's profile only (never addressable by another user — RLS enforced).
- `PUT` upserts; user-confirmed settings win on identity-claim merge (§ #252 "conflicts shown, never silently overwritten").
- Anonymous profile stays **client-local** (mirrors this shape in local storage) and is merged through the existing identity-claim flow on first sign-in.
- Shared `apiError` shape + a rate limit (per-user).

---

## 10. `GET /api/late-food` — crawl-ending food terminals

**Status: EXISTS-ON-CODEX-BRANCH** (`app/api/late-food/route.ts`, `lib/lateFood.ts`). Keyless.

### Request (query params)

```
GET /api/late-food?near=<area>&at=<daypart>&tags=<csv>&limit=<n>
```
- `near` (or `area`): normalized via `normalizeLateFoodArea` (aliases `soho`/`piccadilly` → `piccadilly-soho`). Required. Only 6 seeded areas: `clapham, victoria, piccadilly-soho, canary-wharf, barnes, chiswick`.
- `tags`: CSV, max 8, matched against `category` / `dietary` / name substring.
- `limit`: default 6, max 12.
- `at`: **accepted but currently ignored** (no time-aware ranking yet — §0.7).

### Response `200`

```ts
type LateFoodTerminal = {
  id: string; name: string; area: LateFoodArea;
  category: "kebab" | "pizza" | "cafe" | "restaurant";
  dietary: Array<"vegan" | "vegetarian" | "gluten-free">;
  hours: { service: string; verifyOnNight: true };   // conservative: never asserts open-now
  walkingDetour: { minutes: number; note: string };
  provenance: { kind: "editorial"; source: string; reviewedAt: string };
  confidence: "high" | "medium" | "low";
};
type LateFoodApiSuccessResponse = {
  area: LateFoodArea;                 // canonical slug
  terminals: LateFoodTerminal[];      // ranked: confidence desc, then walkingDetour asc
  rankingSignals: string[];           // ["night_area","category_or_dietary_tags","walking_detour","editorial_confidence"]
  missingEvidence: string[];          // ["live_opening_hours","hygiene_rating","terminal_coordinates"]
};
```

### Errors

`400` `{ error: "near must be one of …", terminals: [] }` for unknown/missing area. **TO-BUILD:** migrate to `apiError` (§7).

### Invariants (#252, honoured)

- Late-food places are modelled **separately** from the Venue Dataset — no `venueId`, no coordinates, no pint prices, no amenities — so they can be a Plan terminal stop but **can never become a pint-price pin or a Pint Drop venue** (`lib/lateFood.ts` type comment enforces this by construction).
- Unknown opening hours are **labelled** (`verifyOnNight: true`, `missingEvidence`), never assumed open.

### Rate limit

**TO-BUILD.** None currently.

### TO-BUILD to reach #252 full spec

Time-aware `at=` ranking (open-at-requested-time confidence first), FSA hygiene evidence, route-home compatibility, terminal coordinates, and coverage for all 20 areas — sourced only from permissible first-party/open data (CityMCP, FSA, OSM, venue-owned pages); never scraped from delivery competitors.

---

## 11. Rate-limit + envelope coverage matrix

| Route | Method | Rate limit | Error envelope | Auth |
| --- | --- | --- | --- | --- |
| `/api/plans/generate` | POST | ✅ `plan-generate` (8/60s; global-key bug §0.4) | flat + 1 structured | keyless |
| `/api/plans/:id` | PATCH | ❌ TO-BUILD | flat → migrate | member token |
| `/api/plans/:id/actions` | POST | ❌ TO-BUILD | flat → migrate | member token (body only — align to Bearer) |
| `/api/plans/:id/complete` | POST/GET | ❌ TO-BUILD | flat → migrate | member token (POST) / public (GET) |
| `/api/night-areas` | GET | ❌ TO-BUILD | flat → migrate | keyless |
| `/api/night-areas/:slug` | GET | ❌ TO-BUILD | flat → migrate | keyless |
| `/api/late-food` | GET | ❌ TO-BUILD | flat+`terminals:[]` → migrate | keyless |
| `/api/me/night-profile` | GET/PUT | TO-BUILD | TO-BUILD (`apiError`) | Supabase Auth |

Existing shared limiter: `isLimited(localKey, durableKey, limit=8, windowMs=60_000, {failClosed?})` from `lib/pintDrops.ts`, with per-domain wrappers (e.g. `lib/lastRideRateLimit.ts`, `lib/roundsReadRateLimit.ts`). Reuse the wrapper pattern; do not invent a new limiter.

---

## 12. Owner decisions (resolved 2026-07-16) + remaining open questions

**Decided by the owner:**

1. **Endpoint name — RESOLVED:** `/api/plans/generate` supersedes #252's `/api/companion/recommend`. The #252 path is a historical alias; do not build it.
2. **Error envelope — RESOLVED:** migrate all THE LOCAL routes to the shared `apiError` `{ error: { code, message, status } }` shape before more clients depend on the flat form. Carry generate's `409` sibling coverage payload in a `details` object on the envelope.
3. **Analytics registry — RESOLVED:** keep Codex's event names (already emitting; renaming buys nothing). #252's registry is amended to the shipped vocabulary; the §8 mapping table records the correspondence.
4. **Product noun — RESOLVED:** "Pub Pal" wins over #252's "Companion" everywhere (UI, code, analytics).

**Still open:**

5. **`plan-generate` durable key** is a global constant — should be per-IP (`plan-generate:${ipHash}`). Treated as a bug; fix lands via the reset-branch gate review.
6. **`/api/plans/:id/actions` auth:** align to the `Authorization: Bearer` header (like PATCH/complete) rather than body-only token?
7. **Late-food scope:** is the static 6-area editorial seed acceptable for Phase 1/2, with time/hygiene/route ranking deferred to a later phase?
8. **Rate limits:** confirm budgets for the read routes (night-areas, late-food) and the member-write routes (PATCH, actions, complete).

---

*Prepared as the Lane‑2 Fable deliverable. Reflects `origin/main` and `origin/codex/pubmaxx-mobile-ui-reset` as read at authoring time. Docs only — no application code changed.*
