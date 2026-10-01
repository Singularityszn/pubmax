# Map route state lifecycle inventory

Source snapshot: Root worktree, 1 October 2026. Read-only inventory for the generated drink/budget state repair; no source or tests changed.

`useMapPlanCoordinator` (`components/map/pubmap/useMapPlanCoordinator.ts:11-46`) currently owns mode, built stop IDs, mapped/open flags, and planned night area. `activateGeneratedPlan(nightArea, venueIds)` stores only night area and IDs. `applyGeneratedMobilePlan` (`components/PubMap.tsx:4695-4706`) passes `generated.context.nightArea` and generated stop IDs, then clears the curated label. It does not pass drink category or budget. `useMapPlanPresentation` selects suggested route in suggest mode and `builtIds` in build mode (`useMapPlanCoordinator.ts:49-82`); `useBuiltIdsPersistence` persists IDs only (`PubMap.tsx:3305-3307`).

| Entry point | Current state operation | Lifecycle classification for narrow generated drink/budget state |
| --- | --- | --- |
| Generated phone plan | `applyGeneratedMobilePlan` -> `activateGeneratedPlan` | New generated route. Capture the generated category/budget with this route. |
| Control Rail Suggest / Build buttons | `onModeChange={setMode}`; `ControlRail.tsx:184-198` | Presentation switch only. It keeps `builtIds`; do not discard generated state just because suggested route is shown temporarily. |
| Reverse route | `reverseRoute` -> `setBuiltIds(current => [...current].reverse())`; `PubMap.tsx:4188-4194` | Reorder only. Preserve route-scoped generated state; curated label is cleared. |
| Manual Add / Remove stop | `toggleBuiltStop`; `PubMap.tsx:4170-4186` | Manual route mutation. Clear generated category/budget rather than attributing the generated constraints to an edited route. |
| Clear route | `clearBuilt`; `PubMap.tsx:4196-4202` | Route clear. Clear generated state with IDs and mapped flag. |
| Load curated crawl by hydration | async `curatedCrawlHydrationFromSeed`; `PubMap.tsx:1707-1758` | Route replacement. It sets build mode/IDs, applies curated filters and `altStyle`, and stores `activeCrawl`; clear generated state. |
| Load curated crawl from UI | `loadCuratedCrawl`; `PubMap.tsx:4220-4242` | Route replacement. It sets IDs, curated filters, style, and active crawl; clear generated state. |
| Nearby crawl | `finish` branch after `nearestVenueIds`; `PubMap.tsx:3527-3543` | New nearby route. Clear generated state. The separate `request.kind === "map"` branch is a venue-list result and does not set route IDs (`3513-3525`). |
| Landmark "Start a crawl here" | `useLandmarkJourney.startCrawlFromPubs`; `useLandmarkJourney.ts:38-58`, passed at `PubMap.tsx:4249-4261` | New route from nearest pubs. Clear generated state. The landmark ask/select action only opens a venue and is not a route mutation. |
| Crawl style control | `RouteHeader` `onAltStyleChange={setAltStyle}`; `PubMap.tsx:5410-5414`, `RouteHeader.tsx:77-94` | Style/copy choice only. It does not replace stop IDs or change drink category. Do not treat it as generated drink authority. |
| Drink lane, experience lens, persona, or beer brand | `changeDrinkLane` (`PubMap.tsx:3612-3624`), `changeExperienceLens` (`3691-3744`), `selectPersona` (`3772-3801`), `changeDrinkBrand` (`3626-3639`) | Explicit display/category-context changes. They change map filters but do not replace `builtIds`. Decide deliberately whether they override generated drink display state; do not infer a new route or budget from the lens alone. `changeExperienceLens("all")` restores its saved pre-lens filters. |

No separate route mutation occurs on pin inspection (`handleVenueClick`, `PubMap.tsx:4204-4218`). Existing coordinator has no generated budget/category slot, so route restore/persistence currently cannot carry that authority with the saved IDs. Any repair should scope category/budget to generated route activation, retain it for mode/reorder-only changes, and clear it on route replacement, manual edits, and clear. Explicit lens changes are a separate override decision because they alter filters without replacing the route.
