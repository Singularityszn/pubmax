# Saved selected-drink price evidence: persistence blocker

Status: migrations `0161` through `0165` with rollbacks added locally on 29 September 2026. The typed Plan read projects valid saved evidence. The composer submits matching selected evidence. Plan creation, route replacement, and guest proposals check it against current trusted server prices. Accepted proposals save that proposal-time snapshot in memory and PostgreSQL. Member route rendering prints valid saved evidence. Completion snapshots now preserve saved evidence. Real browser journeys remain open. No shared migration was executed, and this says nothing about the schema deployed to any database.

## Completion snapshot slice

`__tests__/planSelectedDrinkEvidenceRead.test.ts` failed before the read fix: a saved completion row with wine evidence returned a route stop without it. The mapper now cleans and returns the same five-field evidence contract; malformed serving values stay absent. The memory completion path already copied saved stop evidence.

`__tests__/planSelectedDrinkEvidenceCompletionMigrationEffective.test.ts` reproduced the durable write fault in disposable PostgreSQL: the completion RPC returned `completed`, but its `route_snapshot` contained only venue IDs, names, and positions. Migration `0165` adds a before-insert trigger that copies evidence only from a saved stop matching both position and venue ID in the completion transaction. The effective test then captured wine and cocktail evidence, cleared live stop evidence, and read unchanged completion history. Rollback restores venue-only future snapshots and leaves past completion rows intact. Five focused suites passed (25 tests), including migration inventory and version fences; typecheck, focused ESLint, and diff check passed. Full verify, isolated build, context-drift regression, and real browser save/reload remain open.

## Guest proposal acceptance slice

`__tests__/planCollaborationRoutes.test.ts` first failed because the proposal response lost both wine and cocktail evidence. `__tests__/planSummaryMemberRoute.test.tsx` separately failed because the guest proposal draft discarded saved evidence before POST. The draft now sends the selected stop hint. Proposal creation checks category, figure, report date, venue, and trusted current price against the saved Night Context, then stores only the five public fields. Forged and degraded price hints produce proposals without evidence. An accepted proposal carries its verified historical report, including `serving: null`, into the member route; it does not claim a current or glass price.

The forged-price regression then found a second fault: when a proposal supplied a hint, the shared resolver's refusal branches copied it from the input stop. The test saw a forged £1.00 survive despite a trusted £7.50 report. The resolver now strips input stops to canonical venue ID and name before any return, including degraded and error paths. Focused creation, replacement, and proposal tests pass after that correction.

The old `decide_plan_route_proposal_atomic` returned `decided` while inserting null evidence. `__tests__/planSelectedDrinkEvidenceProposalMigrationEffective.test.ts` reproduced that in disposable PostgreSQL, then proved migration `0164` saves wine and cocktail snapshots, keeps execute service-role-only, replays without changing the saved stop, and rolls back future acceptance writes without erasing existing evidence. The migration changes no shared database.

After this slice, seven focused suites passed, 53 tests total, including migration inventory and version fences. `npm run typecheck`, focused ESLint, and `git diff --check` passed. Full verify, isolated build, and browser journeys remain reserved for final workflow proof.

## Member route display slice

`__tests__/planSummaryMemberRoute.test.tsx` first showed that a member read carrying saved wine evidence passed no price to the route. `__tests__/planRouteSelectedDrinkEvidence.test.tsx` separately showed that the route renderer omitted a supplied wine report. Both tests failed on the missing visible claim before this change. The member route now carries cleaned evidence through its canonical stops and prints drink category, saved figure, community report date, and the explicit missing serving size. Wine and cocktail renderer cases pass; unpriced and malformed beer claims print no community price. The composer and saved route share one description function. Route editing retains evidence for unchanged stops in its PATCH body, where the server rechecks current price authority, and swaps carry only the selected venue's own evidence. These checks prove component behavior, not a browser save and reload.

Seven focused suites passed, 109 tests total. `npm run typecheck`, focused ESLint, and `git diff --check` passed. The run reserved full `npm run verify` and isolated production build for the final browser workflow slice; neither ran here.

## Create retry stability

The first create can save a trusted wine snapshot, then its response can be lost. The same request and idempotency key used to return `409 PLAN_IDEMPOTENCY_CONFLICT` if price coverage degraded before retry: the request hash included the server-derived snapshot, which disappeared on the second attempt. `__tests__/planSelectedDrinkEvidenceCreate.test.ts` reproduced that 409 before the fix. The route now hashes canonical venue names and cleaned submitted evidence while it persists only current server-verified evidence. A retry returns the original Plan and original snapshot; a changed submitted figure remains a conflict. `__tests__/planStoreContextAtomic.test.ts` also checks the durable RPC receives the same hash when its resolved stop payload differs, and a changed hint produces a different hash. Both focused suites passed (8 tests), as did typecheck, focused lint, and isolated `NEXT_DIST_DIR=.next-prod` production build. Build-generated venue data was restored. This is local API and RPC-contract proof, not a live database replay. During a mixed-version rollout, a retry first handled by an older application version can still use its prior hash semantics if price authority changed; keep rollout verification explicit.

## Route replacement slice

`__tests__/planSelectedDrinkEvidenceCreate.test.ts` first showed PATCH dropping valid wine evidence on a three-stop route. Replacement now resolves the submitted hint against canonical venues, the submitted or stored Night Context, and current trusted category prices before the store sees it. Wine and cocktail evidence survives memory save and reload. A forged figure or degraded category read saves no evidence; contributor data is stripped. `lib/planStore.ts` passes only verified evidence to the durable RPC. `__tests__/planSelectedDrinkEvidenceReplaceMigrationEffective.test.ts` proved the prior RPC returned `ok` while storing null, then proved migration `0163` stores the snapshot in disposable PostgreSQL. Execute grants remain service-role-only. Its rollback restores old replacement behavior without removing evidence on existing rows. On a rolling deployment with an old RPC, the read-back Plan omits evidence, so the response does not claim a price was saved. No shared migration was applied. Browser journeys and full verify remain open.

After this slice, six focused suites passed (41 tests, 5.53 seconds), typecheck passed, focused lint passed, and an isolated `NEXT_DIST_DIR=.next-prod DEPLOYMENT_VERSION=local npm run build` passed (10.07 seconds). Build-generated venue files were restored. No browser or full-verify claim follows from these checks.

## Reproduction

A wine stop with valid `selectedDrinkPriceEvidence` reaches the draft and preview, then loses that field before Plan storage. A direct call to the Plan input cleaner produced:

```text
submitted: {category:"wine",pence:550,serving:null,source:"community",reportedAt:"2026-09-25T12:00:00.000Z"}
cleanStop: {venueId:"venue-a",venueName:"A"}
preserved: false
```

Command: `./node_modules/.bin/tsx -e 'import { cleanCreatePlan } from "./lib/plan.ts"; const evidence={category:"wine",pence:550,serving:null,source:"community",reportedAt:"2026-09-25T12:00:00.000Z"}; const clean=cleanCreatePlan({creatorName:"Ada",startTime:"2026-09-30T19:00:00.000Z",stops:[{venueId:"venue-a",venueName:"A",selectedDrinkPriceEvidence:evidence}],context:undefined}); console.log(JSON.stringify({submitted:evidence,cleanStop:clean?.stops[0],preserved:JSON.stringify(clean?.stops[0]).includes("selectedDrinkPriceEvidence")}));'`

Before the composer and create changes below, the submit path dropped the field at both boundaries: `composerCreatePayload` mapped each stop to venue ID and name, and `POST /api/plans` resolved it through `planStopResolver` to those same two fields. `cleanCreatePlan` did the same. The command above records that earlier loss and no longer describes current memory behavior.

## Schema boundary

- `PlanStopDTO` in `lib/plan.ts` permits bounded selected-drink evidence. `readSupabasePlanState` selects it and `stopFromRow` validates it; a missing-column response retries the old three-field query. Plan creation resolves a submitted hint against trusted category prices and preserves matching venue/category/figure/date evidence. Migration `0162` writes that evidence through the atomic SQL create RPC, including the context wrapper.
- `public.plan_stops` in `supabase/migrations/20260712130423_0024_plans.sql` has venue ID, name, and position. Migration `0161` adds nullable `selected_drink_price_evidence` JSONB with a 512-byte limit and exactly the five public display keys and their bounded values. Its rollback drops the column and its contents while retaining the route.
- `create_plan_idempotent_atomic` now writes `selectedDrinkPriceEvidence` from its server-validated stop input. `create_plan_with_context_idempotent_atomic` delegates to it. Migration `0163` makes `replace_plan_route_atomic` write the same field. Migration `0164` copies the verified proposal snapshot into accepted stops.
- `plans.night_context` is typed planning intent. It is neither a per-stop evidence slot nor an authority for a venue price. `plan_completions.ending_selection` and `plan_route_proposals.stops` have different lifecycle and visibility contracts. Reusing any of them would mislabel the evidence or lose it on route replacement.

## Required next change

Prove the browser journeys and resolve the separate context-drift regression before final verification. Creation, replacement, and proposal creation validate category against saved or submitted `NightContext`, check current server price authority, and retain `serving: null` and the original report date. Missing, stale, mismatched, truncated, or degraded evidence remains absent; it must not become a glass price, cheapest-price claim, or budget total. Plan readers are link-capability holders, so store no contributor identity or private price-report metadata. An app version running against an old replacement or proposal acceptance RPC reads back an absent evidence field and must report that evidence was not saved.

## Local schema proof

`__tests__/planSelectedDrinkEvidenceMigrationEffective.test.ts` applied every earlier migration to disposable PostgreSQL 16. Before `0161`, writing the column failed because it did not exist. After `0161`, an old stop kept its route and gained a null evidence slot; wine evidence round-tripped. The database refused extra keys, oversized values, and an array. Plan stop policies stayed byte-for-byte equal; anonymous readers still lacked column SELECT and authenticated readers still lacked UPDATE. Rollback removed the column and kept the route. The focused proof, migration-version fence, and PostgreSQL suite inventory passed together: 16 tests in 6.12 seconds. Typecheck and isolated `NEXT_DIST_DIR=.next-prod` production build passed. Repository lint exited 0 with 73 warnings outside this change; focused lint had none. The build regenerated lapsed-verification venue JSON, which was restored after the build.

After the server paths are wired, prove generation, preview, save, and reload in a private Playwright context for wine and cocktails, plus missing/degraded evidence and beer. Run focused tests and `DEPLOYMENT_VERSION=local npm run verify`. This record makes no browser or full-verify claim.

## Plan read slice

`__tests__/planSelectedDrinkEvidenceRead.test.ts` reproduced a missing field in the Plan read DTO before the change. The focused suite then passed 3 read cases: valid evidence, malformed evidence omitted, and a missing-column retry that preserves the route without claiming a price. The read test uses a Supabase query double; it does not prove an application write or a live database read. Adjacent privacy tests passed (20 tests across 3 files), typecheck and focused lint passed, and an isolated `NEXT_DIST_DIR=.next-prod` production build passed. Generated venue JSON was restored after the build. Creation, replacement, proposal acceptance, member display, and real save/reload remain open.

## Composer submit slice

`__tests__/planComposerCoverage.test.ts` first showed that a matching wine report vanished from the composer POST payload. `composerCreatePayload` now carries only the five bounded display fields for the selected venue when the Night Context names that category and is not zero-proof. It omits evidence after a category or zero-proof change. A swap submits the selected cocktail venue and its own report. This payload is an untrusted hint; the server must resolve venue and price authority before writing it. The save response and subsequent Plan read still cannot claim that this evidence persisted. Three adjacent focused suites passed, 76 tests in 0.94 seconds. Typecheck, focused lint, and an isolated `NEXT_DIST_DIR=.next-prod` production build passed. Generated venue JSON was restored after the build.

## Memory create slice

`__tests__/planSelectedDrinkEvidenceCreate.test.ts` first failed on the missing evidence in both wine and cocktail create responses. `POST /api/plans` now checks submitted evidence against the current trusted category index after canonical venue resolution. It stores only a server-derived five-field snapshot when category, venue, pence, and report date match. The memory store returns that snapshot after reload. Forged figures, stale dates, lone reports, missing coverage, degraded or truncated reads, and beer remain without selected-drink evidence. A submitted contributor field is not stored, and the anonymous preview still omits the price. At this stage PostgreSQL create RPCs discarded the field; the next slice addresses that loss.

The focused create test failed twice before the fix and passed after. Five adjacent suites passed, 82 tests in 0.74 seconds. Typecheck, focused lint, and an isolated `NEXT_DIST_DIR=.next-prod` production build passed. The build regenerated lapsed-verification venue JSON; that tooling churn was restored. Browser and full-verify evidence remain open.

## PostgreSQL create slice

`__tests__/planSelectedDrinkEvidenceCreateMigrationEffective.test.ts` reproduced a real atomic create that returned `created` but stored null for selected wine and cocktail evidence. Migration `0162` replaces that RPC body without changing its signature or execute grants. The context-aware create RPC delegates to it, so both paths now write the five-field snapshot; an idempotent replay leaves it intact. In disposable PostgreSQL, rollback restored the old write behavior and retained evidence on plans created before rollback. The two focused PostgreSQL and inventory suites passed, 9 tests in 5.09 seconds. Typecheck, focused lint, and an isolated `NEXT_DIST_DIR=.next-prod` production build passed. Full lint exited 0 with 73 existing warnings outside this slice. Build-generated venue JSON was restored. No shared migration was applied. Replacement, proposal acceptance, member UI, and browser save/reload proof remain open.

## Storage value boundary

Linked authenticated Plan members have direct table SELECT on `public.plan_stops`, so an application DTO filter cannot protect malformed raw JSONB. Before the `0161` constraint was tightened, the disposable PostgreSQL proof accepted `category: "beer"` in selected-drink evidence. The constraint now requires a non-beer category from the closed drink vocabulary, integral pence from 1 to 100,000, JSON null serving, `community` source, and a canonical valid UTC millisecond report timestamp. It rejects nested private payloads and JSON null in required fields. The effective test reads valid evidence under a linked member's authenticated role, then verifies malformed writes are refused. The `0162` RPC fixture was corrected from `cocktails` to the actual `cocktail` category. Four focused suites passed, 20 tests in 5.56 seconds; typecheck, focused lint, and isolated production build also passed (build 11.83 seconds). Build-generated venue JSON was restored. No table grants or RLS policy changed, and no shared migration was applied.
