# Quality cleanup candidate

At `ef8310f9b`, repository ESLint reports **22 warnings and zero errors**. The
earlier run recorded 74 warnings before this cleanup. Recount the current head
with `./node_modules/.bin/eslint . -f json`; these numbers are a snapshot, not
a lint budget.

Of the 22 current warnings, 21 are `complexity` and one is
`react-hooks/exhaustive-deps`. Five belong to the original sibling exclusions:
two in `components/PubMap.tsx` and one each in
`components/night/NightModeCard.tsx`, `lib/planDraft.ts`, and
`lib/planGenerationRequest.ts`. `components/map/VenueInspector.tsx` is now
owned by the separate drink-context lane. No rule, threshold, or suppression
changed in this cleanup.

## Why the other 16 complexity warnings remain

- `app/api/plans/[id]/complete/route.ts` keeps the request checks, stored
  completion lookup, host check, canonical ending check, and completion result
  mapping in their current order. Splitting a branch solely to reduce its score
  would make that order harder to inspect.
- `components/PubMapCanvas.tsx`, `components/auth/LoginPage.tsx`,
  `components/map/VenuePriceSubmit.tsx`, `components/map/usePintDrops.ts`,
  `components/pal/PalExperience.tsx`, `components/profile/PubmaxxAccountHub.tsx`,
  and `components/visits/VisitReportPanel.tsx` each coordinate one interactive
  flow with several conditional states. Their warnings remain candidates for
  a behavior-led change when a concrete defect or duplicated rule is found.
- `lib/mapSearchSuggest.ts` ranks distinct area, locality, borough, venue, and
  place sources in one ordered search result. The duplicated group rendering
  was removed separately; this remaining warning covers selection logic.
- `evals/pal/answerKeyResolver.ts` maps named evaluation cases to expected
  answers. Its switch makes the case mapping visible in one place.
- `scripts/harvest/uk-prices/run.mjs` has two warned functions, and
  `scripts/harvest_outer_london_prices.mjs`,
  `scripts/integrate_wikipedia_london_pubs.mjs`, and
  `scripts/merge_london_chain_scrapes.mjs` have one each. Each keeps its
  source-specific read, match, and output decisions together. Change these
  with source fixtures if duplicated rules or wrong output are found.
- `scripts/validate-data.mjs` compares slim shards against the source dataset
  and reports mismatches. Its high score merits later review, but a mechanical
  split would make the cross-file checks less clear without stronger proof.

These warnings remain visible. Retaining them does not waive lint errors,
failing tests, or future warnings. Final `DEPLOYMENT_VERSION=local npm run verify`,
isolated production build, and changed-flow browser checks have not yet run
on this head. Earlier local Out screenshots are in
`artifacts/out-proof/new-cross-inn-390.png` and
`artifacts/out-proof/new-cross-inn-1440.png`; `artifacts/` is ignored, so these
screenshots are not portable branch evidence.
