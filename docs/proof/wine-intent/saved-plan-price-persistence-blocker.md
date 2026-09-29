# Saved selected-drink price evidence: persistence blocker

Status: migration `0161` and rollback added locally on 29 September 2026. The typed Plan read projects valid saved evidence. The composer now submits matching selected evidence, but the server still drops it before Plan storage. No shared migration was executed, and this says nothing about the schema deployed to any database.

## Reproduction

A wine stop with valid `selectedDrinkPriceEvidence` reaches the draft and preview, then loses that field before Plan storage. A direct call to the Plan input cleaner produced:

```text
submitted: {category:"wine",pence:550,serving:null,source:"community",reportedAt:"2026-09-25T12:00:00.000Z"}
cleanStop: {venueId:"venue-a",venueName:"A"}
preserved: false
```

Command: `./node_modules/.bin/tsx -e 'import { cleanCreatePlan } from "./lib/plan.ts"; const evidence={category:"wine",pence:550,serving:null,source:"community",reportedAt:"2026-09-25T12:00:00.000Z"}; const clean=cleanCreatePlan({creatorName:"Ada",startTime:"2026-09-30T19:00:00.000Z",stops:[{venueId:"venue-a",venueName:"A",selectedDrinkPriceEvidence:evidence}],context:undefined}); console.log(JSON.stringify({submitted:evidence,cleanStop:clean?.stops[0],preserved:JSON.stringify(clean?.stops[0]).includes("selectedDrinkPriceEvidence")}));'`

Before the composer change below, the submit path dropped the field even earlier: `composerCreatePayload` mapped each stop to venue ID and name. `POST /api/plans` still resolves each submitted stop through `planStopResolver`, which returns only canonical venue ID and name. `cleanCreatePlan` in `lib/plan.ts` has the same two-field stop contract. The reproduction remains valid for that later loss point.

## Schema boundary

- `PlanStopDTO` in `lib/plan.ts` now permits bounded selected-drink evidence. `readSupabasePlanState` selects it and `stopFromRow` validates it; a missing-column response retries the old three-field query. The composer sends matching evidence with the chosen venue, but the server still constructs stops from the two-field resolved input. The memory store still constructs stops from the two-field cleaned input.
- `public.plan_stops` in `supabase/migrations/20260712130423_0024_plans.sql` has venue ID, name, and position. Migration `0161` adds nullable `selected_drink_price_evidence` JSONB with a 512-byte limit and exactly the five public display keys. Its rollback drops the column and its contents while retaining the route. The application does not write the new column yet.
- `create_plan_idempotent_atomic` in `supabase/migrations/20260716200000_0035_plan_write_idempotency.sql` extracts only venue ID and name from `p_stops`. `create_plan_with_context_idempotent_atomic` delegates to it. `replace_plan_route_atomic` in `supabase/migrations/20260811120000_0104_plan_stop_counts.sql` deletes and reinserts only those same stop fields. Route-proposal acceptance has the same insert shape.
- `plans.night_context` is typed planning intent. It is neither a per-stop evidence slot nor an authority for a venue price. `plan_completions.ending_selection` and `plan_route_proposals.stops` have different lifecycle and visibility contracts. Reusing any of them would mislabel the evidence or lose it on route replacement.

## Required next change

Update creation, replacement, and proposal-acceptance writes, then the typed Plan state and reads. Validate category against saved `NightContext`, require a server-authoritative price lookup or grounded proof before storing any submitted evidence, and retain `serving: null` and the original report date. Missing, stale, mismatched, or degraded evidence must remain absent; it must not become a glass price, cheapest-price claim, or budget total. Plan readers are link-capability holders, so store no contributor identity or private price-report metadata. An app version running against the old schema must report that evidence was not saved if it discards the field.

## Local schema proof

`__tests__/planSelectedDrinkEvidenceMigrationEffective.test.ts` applied every earlier migration to disposable PostgreSQL 16. Before `0161`, writing the column failed because it did not exist. After `0161`, an old stop kept its route and gained a null evidence slot; wine evidence round-tripped. The database refused extra keys, oversized values, and an array. Plan stop policies stayed byte-for-byte equal; anonymous readers still lacked column SELECT and authenticated readers still lacked UPDATE. Rollback removed the column and kept the route. The focused proof, migration-version fence, and PostgreSQL suite inventory passed together: 16 tests in 6.12 seconds. Typecheck and isolated `NEXT_DIST_DIR=.next-prod` production build passed. Repository lint exited 0 with 73 warnings outside this change; focused lint had none. The build regenerated lapsed-verification venue JSON, which was restored after the build.

After the server paths are wired, prove generation, preview, save, and reload in a private Playwright context for wine and cocktails, plus missing/degraded evidence and beer. Run focused tests and `DEPLOYMENT_VERSION=local npm run verify`. This record makes no browser or full-verify claim.

## Plan read slice

`__tests__/planSelectedDrinkEvidenceRead.test.ts` reproduced a missing field in the Plan read DTO before the change. The focused suite then passed 3 read cases: valid evidence, malformed evidence omitted, and a missing-column retry that preserves the route without claiming a price. The read test uses a Supabase query double; it does not prove an application write or a live database read. Adjacent privacy tests passed (20 tests across 3 files), typecheck and focused lint passed, and an isolated `NEXT_DIST_DIR=.next-prod` production build passed. Generated venue JSON was restored after the build. Creation, replacement, proposal acceptance, member display, and real save/reload remain open.

## Composer submit slice

`__tests__/planComposerCoverage.test.ts` first showed that a matching wine report vanished from the composer POST payload. `composerCreatePayload` now carries only the five bounded display fields for the selected venue when the Night Context names that category and is not zero-proof. It omits evidence after a category or zero-proof change. A swap submits the selected cocktail venue and its own report. This payload is an untrusted hint; the server must resolve venue and price authority before writing it. The save response and subsequent Plan read still cannot claim that this evidence persisted. Three adjacent focused suites passed, 76 tests in 0.94 seconds. Typecheck, focused lint, and an isolated `NEXT_DIST_DIR=.next-prod` production build passed. Generated venue JSON was restored after the build.
