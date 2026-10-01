# R36 Main / Core Map and Plan semantic composition

Source review only. No browser, tests, build, database, install, network request, Git mutation or maintained-source edit performed for this receipt. New reproduction and final verification remain pending.

Compared base `76de20674da64604af22872ff42ee08fca7f156a`, upstream Main `af5a08f78afad1091efc7ed97d1906daf9b47db1`, and current Core worktree at `/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx` (committed Core `5de246205d8ff0fd1d601c94f3a73639476a3db1` plus owned uncommitted work). Main-to-Core differences include Core's unmerged improvements. Their absence from Main is not evidence of upstream removal. References below identify which tree owns each contract.

Applicable ownership: `components/AGENTS.md`, `docs/rules/components-sheets-chrome-and-navigation.md`, `docs/rules/components-venue-plan-and-message-surfaces.md`, `lib/AGENTS.md`, `docs/rules/lib-venues-areas-listings-and-nights.md`, and area test/document rules. This review does not authorize migration application or publication.

## Map price intent: compose Main's lifecycle into Core's owner

Main adds `VenueInspector.onPriceIntentConsumed` (Main `components/map/VenueInspector.tsx:136`, return actions near 389) and connects it to `clearLogIntent` (Main `components/PubMap.tsx:5549`). It fires when the contribution-return controller opens the form or abandons a venue mismatch. It does not fire merely because an anonymous sign-in gate is shown, and is not a replacement for every manual price-button action.

Core's same return effect (`components/map/VenueInspector.tsx:368`) still passes `openForm: openPriceForm` and only resets child sign-in state on abandonment. `lib/priceContributionIntent.ts:128` already clears contribution URL/storage on successful return or mismatch, but Core's parent intent owner also tracks the search string and a cleared state (`components/PubMap.tsx:729`). Clearing URL through that helper alone is not the same contract as retiring the parent's request. Add the callback to the actual Core inspector mount and return actions, without changing auth startup or helper venue/TTL checks.

Main also owns three coupled parent changes absent Core:

- First selected pub binds an outstanding price intent (`priceIntentVenueRef`, Main `components/PubMap.tsx:4087`). Selecting a different pub retires it, including mounted client `sel` navigation that replaces the inspector and loses its local sign-in gate. Main's cross-city search carry condition permits only a still-unbound picker request (`:4513`); Core currently carries any category intent (`Core :4520`). Intended outcome: a request for pub A cannot accidentally gate pub B.
- Surface history records `pricePicker: true` for the moment picker (Main `:4821` onward). Picker Back restores the intent and resets the first-pub binding. Core's `restoreMapSurface` (`:4885`) instead calls `closeEverySurface`, which clears the intent for every restoration (`:4868`). Intended outcome: Back to Choose a pub permits a deliberate new choice; Home retires the request.
- Main's cleared-intent popstate handler preserves a history entry that actually owns the price picker (`holdsPricePicker`, Main `:727`). Core's cleared-state listener always drops contribution parameters (`Core :764`). This belongs with picker restoration, not as an isolated URL exception.

These are source-demonstrated ownership differences and future reproduction candidates, not newly executed native bugs. Smallest composition is callback plus the coupled first-pub/picker-history lifecycle, adapted manually to Core's current surface coordinator. Do not replace Core's whole PubMap or auth controller.

Already compatible behavior must remain:

- Core already consumes both legacy log and category contribution parameters and publishes its history replacement to Next (`dropLogParamFromUrl`, `components/PubMap.tsx:711`). It keeps the chosen drink, separates category price collection from Pint Drop, and routes restored crawl context through `onSurfaceClose` (`:4933`). No second URL owner is needed.
- `useSelParamSync` differs from Main in comments only. Both honor surface-history ownership and the selection sentinel. A wholesale port would not fix a missing executable selection rule.
- Inspector reveal guards have the same venue, sequence and interruption conditions. Main's boolean-to-function rewrite is not evidence of a behavioral fix. Preserve Core's `onInterruptReveal` wiring and measured Inspector warm boundary.
- Core's keyboard owner has later protections absent Main: queued Escape arbitration after other native listeners, `defaultPrevented` checks, actual visible phone-portal ownership, landmark story handling, and pending-task disposal (`components/map/pubmap/useMapKeyboardShortcuts.ts`). Main instead uses a viewport boolean and synchronous desktop Back. Retain Core's implementation; price intent composition does not require reverting it.

Smallest regressions to preserve/port:

1. Main-only `e2e/price-intent-lifecycle.spec.ts:36,56,117`: form consumption then native Home/Create, anonymous first-pub binding, native sheet Back/browser Back to picker followed by a deliberate second choice and Home. Run on a fresh production build after composition.
2. Its `:81` mounted `sel` change case exercises Next's exposed router through page evaluation and aborts detail prefetch to force a fresh inspector. It is a useful controlled integration test, not proof of an existing native Link or real auth provider. Preserve its assertion, then reproduce an actual production client-link path separately if reachable.
3. Existing Core `e2e/city-price-auth-return.spec.ts`: Manchester wine and Bristol cocktail retain selected pub/drink through local auth doubles and show the actual matching form. Doubles prove app return handling, not live provider operation.
4. Preserve Core `__tests__/priceContributionIntent.test.ts` same-pub return/different-pub abandonment, `mapLogIntent.test.ts:214`, `mapCrawlUrlSync.test.tsx:401,510`, and `mapKeyboardShortcuts.test.tsx:124,164,194`. These protect URL intent, pending selection, competing Escape owners, teardown and story navigation.

## Plan request inference: Main's leaf is a real missing behavior

Main introduces `lib/planDrinkRequest.ts:119` and makes `nightPlanning` use `planRequestedDrinkCategory`. Core still invokes general `drinkCategoryFromText` (`lib/nightPlanning.ts:70-72`). Main distinguishes the drink the person requests from a pub/place/menu name, a companion's order, a refusal, and genuinely mixed requests. It uses the existing drink vocabulary, not a new price or serving authority.

Main's `__tests__/nightPlanning.test.ts` covers Gin Palace / Wine Bar location names, a companion's cocktails while the speaker wants pints, refusal clauses, first-person wine against a companion's pints, mixed pints/cocktails, root beer and a glass of red. Port that existing leaf/call-site/test behavior while retaining Core's inference UI ownership (fresh query versus deliberate Drinks correction). Source predicts wrong constraints when a location token is mistaken for the requested drink; no native reproduction was performed here.

Keep Core `e2e/plan-selected-drink-journey.spec.ts:70,106`: a new query replaces stale Any/Beer inference while a deliberate correction for the current query remains authoritative. A fresh production Describe-first journey using a place-name-only query and then an explicit consumption query is the smallest native follow-up. Inspect actual inferred response and Drinks value, not keyword grep or a mocked generation response.

## Proposal evidence: Core already composes most upstream behavior

Main reattaches cleaned submitted price hints in `app/api/plans/[id]/proposals/route.ts:22` because its `canonicalPlanRoute` otherwise drops them. Core's canonical owner already retains bounded primary and alternative evidence (`lib/planRoute.ts:63-74`). Its proposal route passes those canonical stops to the same server evidence resolver. The missing route-local Main map is therefore not a Core evidence-loss finding; copying it adds duplicate ownership without supplying Core's backup contract.

Core's `lib/planSelectedDrinkPriceEvidence.ts` admits bounded listed citations as well as community evidence; its server resolver independently validates source/date/exact serving against published rows, and does not turn a submitted hint into authority. It preserves backup evidence. Main's narrower community-only shape must not overwrite these Core additions. Preserve Core generation/DTO/ranking/API seams and async proposal retry ownership (`lib/planCollaborationStore.ts:213,495,560,816`).

Current-context filtering also already exists in Core:

- Memory route/context updates and read projections call `planStopEvidenceForContext` (`lib/planStore.ts:279,638,798,812`), including alternatives.
- Core migration `20260929230000_0172_plan_proposal_current_context_evidence.sql:78-94` locks the current Plan row, checks revision/status, and drops accepted primary evidence when its category differs or zero-proof is active. Main's later-timestamp migration `20260930120000_0168_plan_proposal_context_evidence.sql` performs the same relevant locked-context decision. Neither source file proves a deployed database has that function.
- Main's migration numeric label 0168 is already used by Core's listed-evidence migration `20260929190000_0168_plan_listed_drink_evidence.sql`. Migration owner must reconcile label/history/rollback custody before final migration gates. Do not blindly add both labels or substitute Main's smaller evidence pipeline. No database change is authorized by this review.

Meaningful existing regressions to retain: `__tests__/planCollaborationRoutes.test.ts:57,90,117` (concurrent proposal retry, trusted wine/cocktail persistence, forged/degraded evidence omission); `planSelectedDrinkEvidenceVariant.test.ts` (listed citation bounds and unknown serving); create/replace-context suites (primary and backups); and `planProposalCurrentContextMigrationEffective.test.ts:64-123` (old pending wine proposal after beer/zero-proof/null context, matching wine, concurrent context edit, rollback). The latter already demonstrates before/after SQL behavior using its existing disposable harness; this review did not run it.

Core's `e2e/plan-selected-drink-journey.spec.ts:159` checks listed primary/backup save/reload, with explicitly controlled replay arms; `plan-selected-drink-disposable.spec.ts:15` covers disposable PostgREST community persistence. Retain their differing evidence levels. Future integration verification should include a real local pending proposal, a host context change, acceptance, and reload, checking actual saved evidence omission versus matching-context retention. Captain still owns migration application.

## Reconciliation ownership

Integration's map/auth owner should compose Main's price-consumed callback, first-pub binding and picker-history state into Core's existing surface owner. Plan/integration owner should port request inference while preserving Core's broader listed/backup evidence; migration owner must resolve duplicate 0168 history against the already-equivalent Core 0172 context guard. Publication owner handles the merge. This source-only receipt is not final gate evidence, native reproduction, auth-provider proof or completion.
