# Locked saved Plan -> Map drink intent sibling

Status: SOURCE CONCERN, NATIVE REPRODUCTION UNRUN. No production/test changes or runtime. Separate from Luna completion-share producer and Root accepted Stop1 release.

## Concrete handoff omission

`PlanSummary.tsx754-758` passes `planId`, `startTime` and canonical member stops to `PlanRoute`, but no route context. `PlanState.context` exists (lib/plan.ts137-145); Summary uses it for `First stop` versus `First pint` immediately above the route (Summary740). Thus authoritative member route context is available in parent but absent at child.

`PlanRoute.tsx118` calls `buildCrawlMapHref` with ordered venue IDs alone. That helper (lib/crawlUrl.ts183-194) builds `mode=build`, default Pint filters and pubs, without `routeDrink`/`routeLow`. Both `See the walking route` (PlanRoute139-142) and mini-map click (PlanRoute136) receive identical IDs-only URL. A fresh destination has no explicit public drink intent; coordinator initial pricing stays null (useMapPlanCoordinator48-50); RoutePanel143-148 falls back to manual crawlSummary/pint round money. Saved nonbeer/zero-proof can therefore lose context across this source path. Actual browser symptom, saved-plan persistence and provider entitlement are not proved by this review.

## Authority and privacy

Safe route-level source is the already authorized member `state.context` closed category and exact zeroProof boolean, projected to existing public RouteDrinkIntent. Do not infer route category or serving from a single stop's selectedDrinkPriceEvidence: a context-null manual plan may have mixed per-stop evidence, and each quote identifies an offer rather than whole-route request. Never send full NightContext, amount, serving, source/day, proof, capability, plan ID, crew or GPS in Map URL. Zero-proof precedence and manual context-absent/Pint compatibility should match existing codec.

The server shared page passes preview only; PlanSummary306-356 fetches member projection and renders redacted preview until authorized state exists. This is not evidence of an anonymous route disclosure. The Map CTA is a deliberate member action sharing current canonical IDs, already part of current product contract.

## Smallest future actual reproduction

Create/reload an actual authorized saved nonbeer Plan using approved real source and existing canonical server path; confirm current category and ordered member stops first. Click native `See the walking route`; on fresh Map inspect resulting public URL/current IDs, requested header and unknown round money, no silent Pint estimate. Repeat zero-proof; preserve manual Pint/context-absent controls. Existing `planRouteSelectedDrinkEvidence.test.tsx`, `planCrawlRouteMap.test.ts` and `crawlUrl.test.ts` provide later unit seams. Unit markup alone cannot prove full saved Plan/native routing. No repair proposed before Root native RED.

This sibling remains distinct from generated completion sharing, selected-offer serving groups and the pending curated-hydration edge. Smallest eventual seam is optional public-intent input on existing buildCrawlMapHref plus explicit Summary -> PlanRoute route intent prop, not a new store or authority framework.

## Current source pins

Root HEAD `872021c1a12419129aee9849d7877597b7f7b4b4`; working-tree overlays captured below.

| Path | SHA256 |
| --- | --- |
| `components/plan/PlanRoute.tsx` | `17e34571e6d3a5fa6d4242a1442f1e1e79ff391e89c969a5eaecf6618baa68a0` |
| `components/plan/PlanSummary.tsx` | `9567006af55962526a73aea4e68f7ee943633acfd2cbbfe87fd0ffb613070039` |
| `lib/crawlUrl.ts` | `eb43872e1478c6d239d5a98efd2dd43990966ca286467371b2a208e6f71bd4e6` |
| `lib/plan.ts` | `ba218fcb001e2da8afaac4212db61a02d34d71715106e8a70c928982df4599b1` |
| `components/map/pubmap/useMapPlanCoordinator.ts` | `9bd3b2860f9a1622605ab1407bcb30bc069e53bfc32d682bdccd8fa001a0a6b6` |
| `components/map/RoutePanel.tsx` | `fb2c4801277276124c34add073588e2b63ebd20aa4b2173969c829706c131ab7` |
