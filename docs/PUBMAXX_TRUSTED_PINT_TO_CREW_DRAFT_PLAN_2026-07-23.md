# PUBMAXX Trusted Pint-to-Crew Plan

## Status / away mode

- **Status:** Superseded for dispatch by `docs/PUBMAXX_TRUSTED_PINT_TO_CREW_IMPLEMENTATION_PLAN_2026-07-23.md`; retained as pre-panel planning record.
- **Pipeline:** Evidence audit and first adversarial panel complete. Karan adopted all 17 recommended owner decisions as written on 2026-07-23.
- **Current authority:** Written planning and review only.
- **No action authorized yet:** No implementation, worktree creation, git push, merge, Vercel deploy, or deployment promotion until final plan approval.
- **Away-mode lock:** No merge to `main`. No production change.
- **Existing local edits:** Preserve untouched.
- **Security:** Owner has been told to rotate or revoke exposed `claudex` gateway credential. Never repeat token value.
- **Implementation gate:** Final implementation plan exists; explicit owner approval remains required before supervisor opens first worktree.

## North star

Make `pubmaxxing.com` best app in world at turning one trusted pint choice into one crew-ready **Plan**.

Primary loop:

1. Person taps **Find my pint**.
2. PUBMAXX returns nearby, dated, sourced pint evidence.
3. Person accepts one **Venue**.
4. **Map** opens with same Venue, area, date, and provenance intact.
5. **Plan** grows around accepted Venue without asking same questions again.
6. Person reviews grounded **Stops**, locks Plan, sends one link.
7. **Friend** opens or joins after value is already clear.
8. Crew follows coherent **Route**.

Optimize trusted handoff completion, not raw Plan creation or copied-link count.

## Verified evidence

### Production browser evidence

- `/near?patch=soho` produces useful value after one area choice: five concrete, dated price results, including £2.55 cheapest pint.
- Landing hero communicates real pint prices and walkable planning credibly.
- Technical baseline strong:
  - LCP: 1,044ms.
  - FCP: 1,044ms.
  - CLS: 0.0031.
  - TTFB: 781.6ms.
  - No runtime page errors during audited journeys.
- Mobile landing is 7,442px long, repeats CTAs, exposes several competing propositions, and uses six bottom-nav actions.
- Desktop landing puts all three hero CTAs at or below y=900 in 1440×900 viewport.
- First mobile Venue handoff collides with map tour:
  - Venue sheet scrim blocks **Skip the tour**.
  - Closing Venue loses selected context.
- Tonight returned 60 repeated 11:30am Curry Club rows around 20:45.
- Tonight and Pub Pal lost Soho locality:
  - Quiet Pint returned distant Wetherspoons across multiple boroughs.
  - No useful distance or walk-time explanation.
- Plan context contradicted accepted context:
  - Soho choice followed by **Cheap round** silently inserted Victoria.
  - Evening choice advanced date to 24 July while page still said **Tonight**.
- Map search gave silent no-results behavior for known-query miss.
- Serious contrast failures measured:
  - **Start a plan:** 2.92:1.
  - **Live product proof:** 2.31:1.
  - Map state produced four 2.92:1 failures.
  - Stories active label: 3.79:1.
  - Tonight badges and map city switch also failed in audited states.
- Desktop map console repeatedly reported:
  - `[pubmap] tile failure burst, reloading style`
  - Invalid `icon-size` zoom expression.
- Stories, Pub Pal breadth, city breadth, and map-layer breadth compete with core value before trust is proven.

### Repository evidence

Useful foundations already exist:

- Near-pint ranking and remembered area:
  - `components/nearme/NearMeNow.tsx`
  - `lib/nearMeAnswer.ts`
  - `lib/nightPatches.ts`
- Canonical Venue map deep link:
  - `lib/venueMapUrl.ts`
- Map URL and selection state:
  - `components/PubMap.tsx`
  - `components/PubMapCanvas.tsx`
  - `lib/crawlUrl.ts`
- Plan intake, exact London time handling, grounded generation, proof signing:
  - `components/plan/PlanIntake.tsx`
  - `components/plan/PlanComposer.tsx`
  - `lib/planIntake.ts`
  - `lib/planGenerationRequest.ts`
  - `lib/planGenerationSelection.server.ts`
  - `lib/planRouteOptimizer.ts`
  - `app/api/plans/generate/route.ts`
- Existing Plan acceptance, sharing, invite, and join metrics:
  - `lib/analyticsEvents.ts`
  - `components/plan/PlanComposer.tsx`
  - `components/plan/PlanCrew.tsx`
  - `components/plan/PlanCollaborationPanel.tsx`
- Tonight filtering and urgency logic:
  - `lib/whatsOnStore.ts`
  - `lib/whatsOnBadges.ts`
  - `components/map/useWhatsOnTonight.ts`
  - `app/tonight/TonightClient.tsx`
- Search code already renders an empty line:
  - `components/map/MapSearchSuggest.tsx`
- Curated map onboarding already suppresses itself for selected Venue state:
  - `lib/bandOnboardingChip.ts`
  - `components/PubMap.tsx`

Production behavior still contradicts some repository intent. Existing guards and copy do not count as fixed until browser tests prove rendered behavior from clean storage and deployed artifact.

## Adopted product thesis

PUBMAXX wins through **trusted local evidence connected directly to crew coordination**.

Not discovery feed first. Not social graph first. Not generic AI planner first.

Distinctive product shape:

> Find one pint worth walking to. Keep its evidence and local context intact. Grow it into a grounded Plan. Hand that Plan to Friends.

Trust contract:

- Accepted Venue never disappears silently.
- Accepted area never changes silently.
- Selected date never changes without visible acknowledgement.
- Provenance never becomes generic recommendation copy.
- Map onboarding never blocks explicit incoming intent.
- Plan templates modify mood or occasion, not location already chosen.
- Friend invite starts after Plan value exists.
- Client-carried provenance remains display context only; server recomputes trusted evidence from canonical records.

## Verdict and strongest dissent

### Verdict

**Build differently around trusted pint-to-crew handoff.**

Make **Find my pint** dominant entry. Fix handoff integrity and trust defects before optimizing raw Plan completion, Stories growth, Pub Pal expansion, or social breadth.

### Strongest dissent

**Become definitive dated pint-price index first.**

Planning could wait until price density, freshness, source visibility, and geographic coverage are unquestionably strong. Weak price evidence would make polished handoff machinery irrelevant.

### Recommended reconciliation

Treat dated price index as trust substrate inside P0/P1, not separate product pivot:

- P0 protects date and provenance through handoff.
- P1 strengthens freshness and coverage visibility.
- Broad planning expansion remains blocked until price trust metrics hold.

## Owner decisions

Karan adopted all 17 recommended answers as written on 2026-07-23. These decisions are resolved and now constrain post-resolution review and final implementation planning.

| Decision | Adopted answer | Status |
|---|---|---|
| What outcome owns this cycle? | Trusted Venue acceptance through grounded Plan acceptance, with Friend handoff as downstream proof. | Resolved — adopted as recommended |
| What is primary first-session moment? | Pavement-now decision first; kitchen-table planning remains available after one trusted Venue proves value. | Resolved — adopted as recommended |
| Which event is north-star success? | Grounded Plan accepted, then Friend successfully opens or joins; never count copied link alone. | Resolved — adopted as recommended |
| Must accepted Venue remain Stop 1? | Yes by default. Never drop or reorder it silently. Allow explicit removal or visible conflict resolution. | Resolved — adopted as recommended |
| May first useful Plan contain one Stop and grow, or must it begin with three? | Start from accepted Venue, then generate three grounded Stops only when constraints support them; never fabricate breadth. | Resolved — adopted as recommended |
| Should context-aware Plan skip answered intake steps? | Yes. Accepted area and date appear as editable summary; ask only missing group, budget, or access needs. | Resolved — adopted as recommended |
| Must first Plan and Friend preview work signed out? | Yes through value and privacy preview; require auth only for durable identity-bound actions. | Resolved — adopted as recommended |
| Should landing demote Map and direct Plan entry? | Yes. **Find my pint** primary; Map secondary text action; direct Plan available but not equal-weight hero CTA. | Resolved — adopted as recommended |
| Should next cycle be London-density first? | Yes. Prove dense, fresh, trustworthy London coverage before new-city expansion. | Resolved — adopted as recommended |
| What price freshness contract can PUBMAXX honestly promise? | Publish measured freshness bands first; choose 30, 90, or 180-day promise only after coverage report. | Resolved — adopted as recommended |
| How should Tonight handle repeated chain offers? | Group same offer/source/time, show nearest Venue first, then expandable alternatives. Cap duplicate offer family to two entries in first ten results. | Resolved — adopted as recommended |
| Can Tonight remain public when data cannot support “right now”? | Keep only honest time-valid rows; otherwise degrade wording to **Tonight in London** or hide weak inventory. | Resolved — adopted as recommended |
| Should weak surfaces be hidden or shown with degraded states? | Hide trust-destroying claims; show honest thin states when evidence remains useful. | Resolved — adopted as recommended |
| Are Stories and Pub Pal strategic commitments or removable experiments? | Keep only narrow support roles until core loop proves demand; park expansion. | Resolved — adopted as recommended |
| Which post-night action matters most? | Confirm Stops and submit one fresh price before optional Night Story publishing. | Resolved — adopted as recommended |
| Should price-index dissent replace this Plan? | No. Fund narrow freshness and coverage work in P1, then reassess using trust and conversion evidence. | Resolved — adopted as recommended |
| Should Map tour appear on explicit-intent deep links? | No. Suppress tour for selected Venue, Plan, search, log, and restored-intent entries; defer it until a later clean Map open. | Resolved — adopted as recommended |

## Measurable outcomes and instrumentation gaps

### Provisional outcomes

1. **Useful pint speed**
   - Trusted Venue visible within two user decisions.
   - Result visible within 3 seconds after location or area resolution at p75.

2. **Handoff correctness**
   - Accepted Venue, area, date, and source type preserved in 100% of automated handoff runs.
   - No silent substitution.
   - Telemetry preservation receipt rate at least 98%.

3. **Plan efficiency**
   - Accepted Venue to grounded Route preview in no more than two additional decisions when area and date exist.
   - No repeated area or date question.
   - Anchored Venue retained in grounded Plan unless person explicitly removes it.

4. **Tonight quality**
   - Zero ended listings served.
   - Every visible listing shows real source freshness, not request time.
   - No repeated normalized offer family more than twice in first ten rows.
   - Locality label visible whenever order uses location or remembered area.

5. **Trust quality**
   - Zero serious or critical axe violations on scoped surfaces.
   - All body text reaches 4.5:1.
   - UI boundaries and large text reach 3:1.
   - Zero console errors or warnings in core journey.

6. **Product lift**
   - Establish one-week consented baseline.
   - Then target 25% relative improvement from `venue_accepted` to grounded `plan_accepted`.
   - No regression in `/near` answer rate, Plan save success, invite redemption, or page performance.

### Current instrumentation gaps

- `NearMeNow` has no core answer or Venue-acceptance telemetry.
- Map Venue selection does not distinguish browsing from explicit acceptance into Plan.
- Existing `lane_to_plan` source allowlist excludes near, map search, Pal, and mobile route preview.
- No event proves Venue, area, date, or provenance survived handoff.
- No search no-results event.
- Tonight measures screen and filter use, not result diversity, source age, or result opening.
- `plan_generated` and `plan_accepted` do not record whether Plan was anchored to accepted Venue.
- Analytics consent may produce small samples; correctness must also use deterministic tests and server logs.

### Required event additions

Add fixed, low-cardinality events only:

- `near_answer_ready`
  - `source`: `location`, `remembered-area`, or `picked-area`
  - `resultBand`: `0`, `1-3`, or `4+`
- `venue_accepted`
  - `source`: `near`, `map-search`, `tonight`, or `pal`
  - `hasArea`, `hasDate`, `hasProvenance`
- `planning_handoff_opened`
  - `from`, `to`
- `planning_handoff_preserved`
  - `venue`, `area`, `date`, `provenance`
- `map_search_no_results`
  - no query prop
- `tonight_result_opened`
  - `kind`, `localityBasis`
- Extend grounded Plan events with:
  - `anchored`
  - fixed `source`

Never send raw query, Venue ID, coordinates, Friend data, source URL, or Plan capability.

Likely seams:

- `lib/analyticsEvents.ts`
- `lib/analytics.ts`
- `components/nearme/NearMeNow.tsx`
- `components/PubMap.tsx`
- `components/map/MapSearchSuggest.tsx`
- `app/tonight/TonightClient.tsx`
- `components/plan/PlanComposer.tsx`

## Scope tiers

### P0: Trust and handoff

1. Measurement contract and planning-intent schema.
2. One dominant **Find my pint** landing entry.
3. Explicit Venue acceptance action.
4. Venue, area, date, and provenance continuity through Map and Plan.
5. Map-tour collision removal.
6. Anchored Plan generation.
7. Map-generated Route continuity into Plan.
8. Tonight freshness, repetition, and locality fixes.
9. Narrow Pub Pal locality and navigation fix.
10. Template and `Tonight` date contradiction fixes.
11. Search no-results announcement.
12. Contrast failures.
13. MapLibre `icon-size` warning and style-reload burst.

### P1: Price-index trust substrate

1. Pint freshness coverage by area and Venue.
2. Clear stale, current, and unknown states.
3. Price-density gaps exposed without false completeness.
4. Definitive dated-price index evaluation.
5. Plan intake compression after P0 data.
6. Tonight secondary-lane simplification.
7. Core-funnel reporting and quality dashboard.

### P2: Controlled polish

1. Better handoff recovery after tab duplication or browser restart.
2. Richer accepted-context receipt in Map and Plan.
3. Improved grouped-offer expansion.
4. Additional Plan anchor editing and recovery states.
5. Broader first-session copy polish after funnel evidence.

### Defer

- Broad Stories expansion.
- Broad Pub Pal expansion.
- New cities.
- New map layers.
- New social breadth.
- New feed modes.
- New identity or follower mechanics.
- New content objects.
- Any feature not improving price trust, Venue acceptance, Plan integrity, or Friend handoff.

## Feature-by-feature task breakdown

### F0. Planning-intent contract and baseline instrumentation

**Goal:** One typed, short-lived contract for explicit Venue acceptance.

Create client-safe `PlanningIntentV1` seam, likely `lib/planningIntent.ts`:

```ts
type PlanningIntentV1 = {
  version: 1;
  source: "near" | "map-search" | "tonight" | "pal";
  cityId: string;
  acceptedVenueId: string;
  patchId: string | null;
  nightArea: string | null;
  startsAt: string | null;
  evidenceKind: "price" | "whats-on" | "directory";
  evidenceObservedAt: string | null;
  acceptedAt: string;
  expiresAt: string;
};
```

Rules:

- Write only after explicit **Use this Venue** or **Make it Stop 1** action.
- Store in `sessionStorage`; two-hour TTL.
- No coordinates, free text, Friend data, source URLs, or trusted proof.
- Strict parser, size bound, version check, expiry check.
- Clear on Plan creation, explicit dismissal, or expiry.
- Map and Plan rehydrate Venue and provenance from canonical data.
- Client evidence metadata never authorizes grounding.
- Existing `readRememberedArea()` remains fallback, not competing truth.

Tasks:

- Add analytics registry events.
- Capture baseline without changing ranking.
- Add unit tests for malformed, stale, oversized, and valid intent.
- Add migration-safe behavior when no intent exists.

Dependencies: None.

### F1. Landing entry hierarchy

**Goal:** Make **Find my pint** unmistakable first move.

Likely seams:

- `components/landing/LandingPage.tsx`
- `components/landing/landing.css`
- `e2e/mobile-landing-entry.spec.ts`
- `e2e/screenshots.spec.ts`

Tasks:

- Keep one primary hero button: **Find my pint**.
- Convert **Open the map** to lower-emphasis text or secondary action.
- Move direct **Plan my night** entry below immediate-use action.
- Remove repeated equal-weight CTA pairs from mobile page.
- Keep Map and Plan reachable without hiding them.
- Fit primary CTA inside initial 1440×900 viewport.
- Preserve current hero promise, real metrics, coral/ink identity, and dark theme.
- Do not expand Stories, Pub Pal, or cities during this task.

Dependencies: F0 event names.

### F2. Explicit Venue acceptance and map continuity

**Goal:** Distinguish opening Venue details from accepting Venue into Plan.

Likely seams:

- `components/nearme/NearMeNow.tsx`
- `lib/venueMapUrl.ts`
- `components/PubMap.tsx`
- `components/map/VenueInspector.tsx`
- `components/mobile/MobileSharedSheet.tsx`
- `lib/crawlUrl.ts`

Tasks:

- Add **Use this Venue** action to near-result cards.
- Open Map with canonical `sel=<venueId>`.
- Write `PlanningIntentV1`.
- Keep Venue selected while camera settles.
- Show compact accepted-context receipt:
  - Venue.
  - area.
  - intended date or “Date not set”.
  - source and observed date.
- Add **Make it Stop 1** from Venue sheet.
- Never clear selected Venue because another overlay opens.
- Browser back closes sheet before leaving Map.
- Existing generic `venueMapUrl(id)` remains browse-only.
- Add dedicated planning-link helper rather than hand-building query strings.

Dependencies: F0.

### F3. Suppress onboarding when explicit intent exists

**Goal:** No tour or upsell may cover selected Venue, Plan, search, or log intent.

Likely seams:

- `components/onboarding/FirstRunTour.tsx`
- `lib/firstRunTour.ts`
- `lib/bandOnboardingChip.ts`
- `components/PubMap.tsx`
- `e2e/mobile-first-run-tour.spec.ts`

Tasks:

- Extend pure first-run gate with `hasExplicitMapIntent`.
- Suppress tour for valid:
  - `sel`
  - `pubs`
  - `mode=build`
  - `plan=1`
  - `log=1`
  - restored planning intent
- Defer tour until later clean Map open; do not mark complete automatically.
- Ensure Venue sheet and its close action remain operable at 390×844.
- Add clean-storage deep-link regression tests.
- Test both generic first-run tour and curated crawl onboarding.

Dependencies: F2 intent detection.

### F4. Anchored Plan generation and honest Map-to-Plan transfer

**Goal:** Plan grows from accepted Venue and existing Route instead of starting over.

Likely seams:

- `components/plan/PlanComposer.tsx`
- `components/plan/PlanIntake.tsx`
- `components/plan/MobilePlanActivation.tsx`
- `lib/planIntake.ts`
- `lib/planGenerationRequest.ts`
- `lib/planGenerationSelection.server.ts`
- `lib/planRouteOptimizer.ts`
- `app/api/plans/generate/route.ts`
- `app/plan/page.tsx`

Tasks:

1. **Plan seeding**
   - Read valid planning intent only when no newer Plan draft exists.
   - Seed accepted area and date.
   - Show accepted Venue as locked provisional Stop 1.
   - Skip already answered intake steps.
   - Keep every value editable.

2. **Generator request**
   - Add strictly validated `anchorVenueId`.
   - Reject unknown, wrong-city, promoted, excluded, stale, or constraint-incompatible anchors.
   - Never silently omit anchor.

3. **Route optimizer**
   - Evaluate only feasible Route triples containing anchor.
   - Keep anchor as Stop 1 by recommended default.
   - If no valid Route exists, return explicit `ANCHOR_VENUE_INELIGIBLE`.
   - UI offers:
     - Change date.
     - Change area.
     - Remove accepted Venue.
   - No automatic substitution.

4. **Grounding**
   - Recompute price, area, opening, and provenance server-side.
   - Mint grounding proof over accepted Route and alternatives.
   - Manual Venue edits invalidate proof exactly as current code does.

5. **Map-generated Route handoff**
   - `MobilePlanActivation` currently drops grounding proof and Route draft before linking to `/plan`.
   - Extend generated result with full Stops, alternatives, context, `groundingProof`, and `operationKey`.
   - Extract shared `writePlanRouteDraft()` helper.
   - Persist same draft shape `PlanComposer` already recovers.
   - **Open Plan to lock it in** must open identical Route, not regenerate.

6. **Date language**
   - Replace static `London · Tonight` in `app/plan/page.tsx`.
   - Derive label from exact Europe/London date.
   - Use **Tonight** only for current London service date.
   - Otherwise show explicit weekday and date.

Dependencies: F0, F2.

### F5. Context-safe templates

**Goal:** Templates add occasion, not conflicting geography.

Likely seams:

- `lib/planTemplates.ts`
- `components/plan/PlanComposer.tsx`
- `__tests__/planTemplates.test.ts`
- `__tests__/planIntake.test.ts`

Tasks:

- Replace hard-coded area queries with structured template intent.
- Example **Cheap round** supplies deal/value intent, not Victoria.
- Existing accepted area always wins.
- Template may fill area only when no accepted, remembered, or explicit area exists.
- Template date terms reconcile with exact selected date.
- Template application marks Route stale when it changes Plan constraints.
- Tests cover Soho plus Cheap round, non-tonight date, and explicit area override.

Dependencies: F4 Plan context model.

### F6. Tonight freshness, diversity, and locality

**Goal:** First screen feels current, local, and varied.

Likely seams:

- `lib/whatsOnStore.ts`
- `lib/whatsOnBadges.ts`
- `app/api/whats-on/route.ts`
- `components/map/useWhatsOnTonight.ts`
- `app/tonight/TonightClient.tsx`
- `components/discovery/DealsTonightLane.tsx`
- `components/discovery/MusicTonightLane.tsx`

Tasks:

1. Split API timestamps:
   - `servedAt`: request time.
   - `sourceObservedAt`: real newest relevant source observation.
   - Never label request time as listing freshness.

2. Apply existing `listingUrgency()`:
   - **Happening now**
   - **Starts in N min**
   - explicit later time
   - no ended rows

3. Add pure diversity/grouping helper:
   - Normalize title, kind, source, and schedule.
   - Group chain-wide duplicate offers.
   - Show nearest Venue first.
   - Offer expandable alternate Venues.
   - Cap same offer family to two entries in first ten.

4. Locality:
   - Real location wins.
   - Remembered area follows.
   - Without either, say **Tonight in London**, not **near you**.
   - Show **Nearest Soho first** when remembered patch orders results.

5. Layout:
   - Put trusted main list before duplicate Deals/Music treatment.
   - Collapse or demote secondary lanes when they repeat main list.
   - Keep honest thin-night state.

Dependencies: F0 analytics. Independent from F4.

### F7. Narrow Pub Pal trust fix

**Goal:** Fix locality and dead-end behavior without expanding Pub Pal scope.

Likely seams:

- `lib/vibeChips.ts`
- `lib/palChatClient.ts`
- `components/pal/PalChat.tsx`
- `app/api/concierge/route.ts`
- `lib/concierge/context.ts`

Tasks:

- Carry strict remembered or selected area with Tonight vibe handoff.
- If query names an area, explicit query wins.
- Otherwise use trusted area context as default ranking boundary.
- Add distance or walk-time evidence when area anchor exists.
- Keep provenance chip visible on every card.
- Add standard navigation/back path to Pal Chat.
- Add **Use this Venue** action writing same planning intent.
- Do not add memory, voice expansion, web grounding, personas, or new Pal capability.

Dependencies: F0 and F2 intent writer; F6 locality model.

### F8. Search, contrast, and map console health

**Goal:** Remove visible trust defects and noisy rendering failures.

Likely seams:

- `components/map/MapSearchSuggest.tsx`
- `components/map/mapSearchSuggest.css`
- `components/map/canvas/filters.ts`
- `components/PubMapCanvas.tsx`
- `components/landing/landing.css`
- `app/tonight/tonight.css`
- `components/map/citySwitcher.css`
- `app/globals.css`
- `app/theme.css`

Tasks:

1. **Search no-results**
   - Keep listbox present for typed miss.
   - Add `role="status"` and `aria-live="polite"`.
   - Announce no-result text.
   - Keep clear-search action and suggested area examples.
   - Track miss without query contents.

2. **MapLibre expression**
   - Keep `["zoom"]` at top-level interpolation.
   - Apply selected multiplier inside interpolation stop outputs.
   - Unit-test expression shape accepted by MapLibre.
   - Remove style-reload burst caused by invalid expression.

3. **Contrast**
   - Fix scoped components first.
   - Use dark foreground on light coral CTA where needed.
   - Give semantic badges readable foreground and tinted background.
   - Avoid global token change until all `--color-on-accent` consumers are audited.
   - Verify light and dark themes independently.

Dependencies: None. Can proceed in isolated lanes after owner approval.

## Verification matrix

Run each scenario in light, dark, and `prefers-reduced-motion: reduce` unless marked otherwise.

| Scenario | 390×844 | 1440×900 |
|---|---|---|
| Landing | **Find my pint** visible above fold; one dominant action; no CTA overlap; 44px touch targets. | Primary CTA visible inside first viewport; no y=900 cutoff; Map and Plan remain reachable. |
| Near answer | Pick Soho, receive dated price cards, accept Venue, source/date visible. | Same result ordering and evidence; keyboard activation works. |
| Near to Map | Accepted Venue sheet opens immediately; no tour collision; Venue, area, date, provenance receipt preserved. | Camera centres selected Venue; no onboarding or drawer conflict. |
| Map search miss | Visible and announced no-results state; clear action works; keyboard stays in search. | Combobox/listbox ARIA valid; Enter and Escape behavior correct. |
| Map to Plan | **Make it Stop 1** opens Plan with same Venue, area, and date; answered intake skipped. | Same data; focus lands on accepted-context summary. |
| Map Route to Plan | Generated three Stops and grounding proof survive **Open Plan to lock it in** without regeneration. | Same Stop order, provenance, totals, and Route state. |
| Tonight | No ended rows; duplicates grouped; locality label accurate; first ten diverse. | Main listings lead layout; secondary lanes do not repeat first viewport. |
| Tonight to Pal | Quiet Pint keeps area; cards show local evidence, distance, and provenance; navigation available. | Same locality; keyboard can open Venue and return. |
| Template conflict | Soho plus **Cheap round** stays Soho; date label remains accurate. | Same behavior and explicit context summary. |
| Share and join | Locked Plan exposes privacy preview; Friend opens expected Venue, date, Stops, and Route. | Same Plan truth; no account gate before preview. |
| Theme contrast | Zero serious axe contrast failures. | Zero serious axe contrast failures. |
| Map rendering | No invalid `icon-size`, tile-reload burst, blank frame, or sheet flicker. | Same; map settles within performance budget. |

## Accessibility, console, network, and quality gates

### Accessibility

Required:

- Zero axe critical or serious findings on scoped surfaces.
- Body text contrast at least 4.5:1.
- Large text and UI boundaries at least 3:1.
- No meaning carried by color alone.
- Every interactive mobile target at least 44×44px.
- Tour, sheet, drawer, and Plan focus trapping correct.
- Focus restored to invoking control on close.
- Search miss announced once through live region.
- Loading, generation, and error states use correct `status` or `alert`.
- Full keyboard path through search, Venue acceptance, Plan review, and share preview.
- Reduced motion removes ambient pulses, route animation, and sheet flourish without hiding state.

### Console

Pass only when:

- Zero uncaught errors.
- Zero React hydration warnings.
- Zero accessibility warnings.
- Zero MapLibre expression warnings.
- Zero `[pubmap] tile failure burst, reloading style` messages.
- Informational service-worker update message may remain if single and expected.

### Network

Pass only when:

- No unexpected 4xx or 5xx requests.
- Map tiles return 200 or expected 304 without reload loop.
- `/api/whats-on` distinguishes `servedAt` from source freshness.
- Plan generation and creation retain current fail-closed signing behavior.
- No repeated generation caused by Map-to-Plan handoff.
- No paid or broad external service added.
- No precise location persisted or sent to analytics.

### Performance

- LCP no worse than 2.5s at both viewports.
- CLS no worse than 0.1.
- INP measured after real search, Venue, and Plan interaction; target no worse than 200ms.
- Map useful state within 3 seconds at p75.
- No new first-load bundle for deferred Stories or Pub Pal expansion.

### Test suite

Targeted unit coverage:

- `__tests__/nearMeAnswer.test.ts`
- `__tests__/mapSearchSuggest.test.ts`
- `__tests__/planIntake.test.ts`
- `__tests__/planTemplates.test.ts`
- `__tests__/whatsOnStoreRoute.test.ts`
- `__tests__/whatsOnBadges.test.ts`
- `__tests__/palChatClient.test.ts`
- `__tests__/canvas-filters.test.ts`
- New planning-intent and anchored-Route tests.

Targeted E2E coverage:

- `e2e/mobile-landing-entry.spec.ts`
- `e2e/mobile-first-run-tour.spec.ts`
- `e2e/mobile-map-search.spec.ts`
- `e2e/mobile-map-planner.spec.ts`
- `e2e/mobile-plan-flow.spec.ts`
- `e2e/plan-intake.spec.ts`
- `e2e/plan-loop.spec.ts`
- `e2e/mobile-tonight.spec.ts`
- `e2e/tonight.spec.ts`
- `e2e/mobile-pal-layout.spec.ts`
- `e2e/map-console-health.spec.ts`
- `e2e/mobile-map-shell-matrix.spec.ts`
- New trusted pint-to-crew E2E spec spanning Near, Map, Plan, and Friend preview.

Final lane verification:

```bash
npm ci
npm run test
npm run lint
npm run typecheck
npm run build
npm run verify
```

Use isolated `NEXT_DIST_DIR` for production browser QA. Never share `.next` between worktrees.

## Dispatch policy

Every later implementation wave must obey:

1. **Model**
   - Only `gpt-5.6-sol`.
   - Only through `claudex`.
   - No Claude implementation agents.
   - Announce exact model and effort before each delegation.

2. **Effort**
   - `low`: isolated copy, CSS, or test adjustment.
   - `medium`: single-surface state and analytics work.
   - `high`: handoff contract, Plan generator, optimizer, or cross-route integration.
   - Never `xhigh`.
   - Never `max`.

3. **Git isolation**
   - One feature per git worktree.
   - One branch per feature.
   - No shared lane.
   - No two implementers editing same files concurrently.
   - Rebase or reconcile only after lane verification.

4. **Roles**
   - Implementer writes code.
   - Fresh-eyes verifier must be different agent.
   - Recorded code reviewer must be different pass from implementation.
   - Maximum two revision cycles per feature.
   - Failure after cycle two returns to owner with evidence; no endless agent loop.

5. **Review before outward action**
   - Full recorded code review required before any push.
   - Record findings, severity, disposition, tests, and unresolved risk.
   - No push with unresolved high-severity finding.

6. **Away mode**
   - No merge to `main`.
   - No Vercel deploy.
   - No Vercel promotion.
   - No production mutation.
   - Isolated branches may exist only after owner approves implementation.
   - Owner must approve merge order after returning.

7. **Credential safety**
   - Rotate or revoke exposed local gateway credential before `claudex` dispatch.
   - Never print aliases, environment exports, or token-bearing shell expansion.

## Risks and rollback

### Stale or tampered planning intent

Risk: Client state claims wrong Venue, area, or provenance.

Control:

- Strict schema, TTL, and size bound.
- Server rehydrates canonical Venue.
- Server recomputes grounding and provenance.
- Unknown state discarded without blocking generic flow.

Rollback: Disable intent read path; existing Near, Map, and Plan remain available.

### Anchored Venue makes Route impossible

Risk: Accepted Venue conflicts with date, access, budget, or area.

Control:

- Explicit error.
- Preserve accepted Venue visibly.
- Offer change date, area, or explicit anchor removal.
- Never silently swap it.

Rollback: Keep anchor as editable manual Stop while disabling hard-anchor generation.

### Plan draft compatibility

Risk: New Route-draft shape breaks old recovered drafts.

Control:

- Version draft.
- Backward-compatible parser.
- Unknown fields ignored.
- Invalid proof fails closed.

Rollback: Retain current recovery parser and discard only new fields.

### Tonight grouping hides distinct listings

Risk: Legitimate events collapse together.

Control:

- Group key includes normalized title, kind, source, and schedule.
- Keep raw Venue count.
- Expandable alternate Venue list.
- Unit tests for similar but distinct events.

Rollback: Disable grouping helper; retain freshness and ended-row filtering.

### Contrast fix changes brand feel

Risk: Global foreground-token change affects many surfaces.

Control:

- Fix audited selectors locally first.
- Audit all global token consumers before token change.
- Screenshot comparison in both themes.

Rollback: Revert scoped CSS commit only.

### Map rendering regression

Risk: Corrected expression changes pin size or selection readability.

Control:

- Unit-test expression structure.
- Screenshot selected and unselected pins.
- Console-health E2E.
- Test MapLibre current pinned version.

Rollback: Remove selected-size multiplier while retaining selection glow and opacity.

### Sparse analytics

Risk: Consent gating leaves insufficient product sample.

Control:

- Preserve consent and privacy contract.
- Use deterministic correctness tests.
- Report sample size beside rates.
- Do not weaken consent or add fingerprinting.

### Deployment parity

Risk: Repository fix exists but domain serves stale or different deployment.

Control after away mode ends:

- Record expected commit SHA and deployment ID.
- Verify live domain resolves to intended deployment.
- Repeat browser matrix against production.
- Do not infer deployment success from build success.

Rollback: Promote last verified deployment only with owner authorization.

## Ordered execution sequence

1. Owner decisions resolved on 2026-07-23: all 17 recommended answers adopted as written.
2. Compact context and run post-resolution adversarial panel against binding decisions.
3. Produce final implementation plan with exact worktree, branch, dependency, verification, and review assignments.
4. Obtain explicit owner approval for final plan before implementation.
5. Confirm exposed `claudex` gateway credential has been rotated or revoked before implementation-agent dispatch.
6. Freeze P0 scope and assign one worktree per feature.
7. Implement F0 planning-intent contract and analytics registry.
8. Implement F3 onboarding suppression and F8 search/map-console fixes as independent low-risk lanes.
9. Implement F2 explicit Venue acceptance and Map continuity.
10. Implement F4 anchored Plan generation and honest Map-to-Plan transfer.
11. Implement F5 context-safe templates and date language.
12. Implement F1 landing hierarchy against working handoff.
13. Implement F6 Tonight freshness, grouping, and locality.
14. Implement F7 narrow Pub Pal locality and navigation fix.
15. Run targeted unit and E2E tests in each worktree.
16. Run exact 390×844 and 1440×900 verification matrix.
17. Run fresh-eyes verification by separate `gpt-5.6-sol` agent.
18. Run full recorded code review before any push.
19. Allow no more than two revision cycles per feature.
20. Present branch evidence, unresolved risks, and recommended merge order to owner.
21. While away mode remains active, stop before push, merge, or deployment unless owner gives new explicit authorization.
22. After owner returns and approves, push reviewed branches, merge in dependency order, deploy once, verify deployment ID, then repeat production matrix.
