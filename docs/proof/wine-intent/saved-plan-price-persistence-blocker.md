# Saved selected-drink price evidence: persistence blocker

Status: blocked at the committed Plan persistence schema on 29 September 2026. This records repository state, not the schema currently deployed to any database. No migration was executed.

## Reproduction

A wine stop with valid `selectedDrinkPriceEvidence` reaches the draft and preview, then loses that field before Plan storage. A direct call to the Plan input cleaner produced:

```text
submitted: {category:"wine",pence:550,serving:null,source:"community",reportedAt:"2026-09-25T12:00:00.000Z"}
cleanStop: {venueId:"venue-a",venueName:"A"}
preserved: false
```

Command: `./node_modules/.bin/tsx -e 'import { cleanCreatePlan } from "./lib/plan.ts"; const evidence={category:"wine",pence:550,serving:null,source:"community",reportedAt:"2026-09-25T12:00:00.000Z"}; const clean=cleanCreatePlan({creatorName:"Ada",startTime:"2026-09-30T19:00:00.000Z",stops:[{venueId:"venue-a",venueName:"A",selectedDrinkPriceEvidence:evidence}],context:undefined}); console.log(JSON.stringify({submitted:evidence,cleanStop:clean?.stops[0],preserved:JSON.stringify(clean?.stops[0]).includes("selectedDrinkPriceEvidence")}));'`

The real submit path drops the field even earlier: `composerCreatePayload` in `components/plan/PlanComposer.tsx` maps each stop to venue ID and name. `POST /api/plans` resolves each submitted stop through `planStopResolver`, which returns only canonical venue ID and name. `cleanCreatePlan` in `lib/plan.ts` has the same two-field stop contract. Thus the reproduction shows a later independent loss point, not the first one.

## Schema boundary

- `PlanStopDTO` in `lib/plan.ts` has only venue ID, name, and position. Both `readSupabasePlanState` and `stopFromRow` in `lib/planStore.ts` read those three fields. The memory store also constructs stops from the two-field cleaned input.
- `public.plan_stops` in `supabase/migrations/20260712130423_0024_plans.sql` has venue ID, name, and position, with no price or evidence column. No later committed migration adds one.
- `create_plan_idempotent_atomic` in `supabase/migrations/20260716200000_0035_plan_write_idempotency.sql` extracts only venue ID and name from `p_stops`. `create_plan_with_context_idempotent_atomic` delegates to it. `replace_plan_route_atomic` in `supabase/migrations/20260811120000_0104_plan_stop_counts.sql` deletes and reinserts only those same stop fields. Route-proposal acceptance has the same insert shape.
- `plans.night_context` is typed planning intent. It is neither a per-stop evidence slot nor an authority for a venue price. `plan_completions.ending_selection` and `plan_route_proposals.stops` have different lifecycle and visibility contracts. Reusing any of them would mislabel the evidence or lose it on route replacement.

## Required next change

Add a nullable, bounded, per-stop evidence field through a forward migration and rollback. Update the creation, replacement, and proposal-acceptance writes, then the typed Plan state and reads. Validate category against saved `NightContext`, require a server-authoritative price lookup or grounded proof before storing any submitted evidence, and retain `serving: null` and the original report date. Missing, stale, mismatched, or degraded evidence must remain absent; it must not become a glass price, cheapest-price claim, or budget total. Plan readers are link-capability holders, so store no contributor identity or private price-report metadata.

After that schema is available, prove generation, preview, save, and reload in a private Playwright context for wine and cocktails, plus missing/degraded evidence and beer. Run focused tests, `DEPLOYMENT_VERSION=local npm run verify`, and an isolated production build. None of those browser or full-gate claims is made by this blocker record.
