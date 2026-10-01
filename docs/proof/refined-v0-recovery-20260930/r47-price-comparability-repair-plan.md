# R47 Map List comparability repair plan

> **SUPERSEDED end-state interpretation:** `r47-cheapest-alcohol-goal-fidelity.md` corrects this plan's blanket no-comparison and named-identity rationale. Same named drink/serve protects claim supersession and reconciliation; it is not required for an honestly labelled cheapest category offer with the same explicitly recorded serving. `listedCategoryPrices.ts:113-147` and its Rioja/Chenin regression at `__tests__/listedCategoryPrices.test.ts:142-167` already permit that comparison. Neutral Nearest/no Cheapest may be a temporary safety guard after native RED, but cannot complete the user's cheapest-wine/any-alcohol goal. API serving-group preservation and honest unranked unknown servings remain required. Implementation stays queued behind Home/drag.

Conditioned on native/API reproduction of the retained Brownswood/Scolt Head gin case from `r47-price-ranking-source-review.md`. Source planning only, 1 October 2026. Only this receipt written. No product/data/test change, network, runtime or database action. All proposed checks are UNRUN.

## Domain boundary

Applicable owners: `lib/AGENTS.md` and `docs/rules/lib-prices-trust-and-drinks.md` (community visibility versus authority, exact measures, no scaling, non-beer lenses); `components/AGENTS.md` and its sheet/navigation and design detail rules; `__tests__/AGENTS.md` and `e2e/AGENTS.md` for later regressions. Unknown evidence must not be fabricated into a serving, discarded merely because unknown, or promoted into a cheapest comparable claim. Community authority still requires independent corroboration and age; listed and estimates remain different lanes.

`listedServingComparisonKey` is a pure serving classifier, not a complete cross-venue drink comparator. It checks category and explicit identical ml only. `__tests__/listedPriceComparison.test.ts` protects unknown, bottle, mixed and ambiguous serving rejection. It receives no drink identity. `bundleRowDedupeDrinkKey` preserves a trimmed literal drink name and serving for bundle dedupe; it is not a publisher alias/brand-equivalence resolver. `listedCategoryPrices` also deliberately chooses representative prices across different drinks inside one category/serve; its existing test explicitly compares Rioja with Chenin. That venue-menu projection is not permission to assert that two unlike named drinks are the same comparable claim across venues.

Current `MapLensPrice` has no drinkLabel; trusted community entries also have no serving. The public category index has already reduced each venue to a representative quote. Therefore neither grouping by ml nor bolting the serving helper into List's comparator establishes the required identity. Recovering all names, measures and quote groups would widen the API/data contract and is unnecessary for this bounded bug.

## Recommended smallest repair

Use the existing neutral Nearest order for a selected price lens and stop offering Cheapest there. Keep amounts as attributed quotes with explicit serving/unknown wording; keep all admitted venues selectable. This is omission of an unsupported ranking, not omission of evidence or restriction to beer-only discovery. It matches the existing neutral selected-drink policy in `lib/areaButton.ts:344-367` and `AreaSheet.tsx:216-221`. A future same-drink/serve comparison needs a separately grounded identity contract; this patch must not claim it is implemented.

Bounded production seams, owned by Core's Map owner:

1. **`lib/mapVenueList.ts`.** The pure model must run its amount comparator only for the default pint mode (`lensPrices === null`). For an active lens it retains the existing Nearest base rows even when a caller supplies remembered `cheapest`. No new grouping helper, wrapper or exported interface. Preserve membership, projected viewport, limits, null handling, stable IDs and all row amounts. Update the selected-lens row's existing `priceLabel` to state recorded serving or `serving not recorded`; use the already available source/date fields for concise provenance when rendered, without inventing a label or date. No source fetch.
2. **`components/PubMap.tsx`.** Derive one effective List sort mode from the existing lens state: remembered sort for the default pint lane, `nearest` for an active lens. Pass that effective mode to both the model and `MapVenueList`. Omit the existing optional `onSortModeChange` callback for the active lens, so the component's already owned sort-control guard hides the unsupported choice. Preserve remembered pint sort when returning to beer. No effect-driven state reset or history/query change. The model guard separately protects non-UI callers.
3. **`components/map/MapVenueList.tsx` should need no new contract.** Its optional sort callback already owns control visibility. The count must receive the effective mode, so a truncated lens list never says `Cheapest N of M` merely because the earlier pint list used that state. If implementation needs an additional public capability API, reassess whether these existing props suffice first.

Non-null active lens prices currently represent selected non-beer/experience lanes; default beer is not a selected lens under the existing drink-lane rule. Applying neutral ordering to that existing active-lens seam also avoids comparing different soft drinks/food anchors. Cover those affected siblings explicitly; do not silently retain their old amount claim because the native example uses gin.

### Invariants

- Default pint Cheapest still uses existing map-authority contributor price then permitted baseline; null/unpriced behavior and existing bands remain unchanged. No non-beer amount becomes pint authority.
- Unknown or unlike serving/name quotes remain visible with honest metadata; they do not move ahead because their bare amount is smaller. Same ml does not alone authorise a same-drink comparison.
- Independent corroboration, expiry, listed source/date eligibility, community precedence and unavailable/partial copy stay unchanged. Lone reports still show on their own venue sheet; they still cannot affect map authority. No conversion, default ml, fabricated brand or recategorisation.
- Camera/list membership, selection/keyboard focus, Home/Back, base-pub model and Plan ranking stay outside this repair. No new API request or bundle/parser/generated-data change.
- Nearest count/control state agrees with actual row order immediately on lane switch. Returning to pints may restore the reader's prior pint Cheapest choice.

## Meaningful RED before production edit

Use `__tests__/mapVenueList.test.ts`, the real pure model with actual MapLensPrice inputs, not import/source strings. Add known 25ml gin at a nearer venue and cheaper unknown-serving gin farther away, request `cheapest`, and require neutral Nearest order plus both preserved amounts and serving disclosure. Original comparator should fail that order. Add same-ml/different-name evidence as a boundary case through the actual producer where names exist, then prove List does not gain a comparison capability merely from those ml fields. Do not inject unsupported drinkLabel fields into MapLensPrice to pretend the runtime owns that identity.

Protect wine, whisky and mixed-serving siblings; corroborated-community versus listed precedence; uncorroborated exclusion through the real `discoveryDrinkLensPrices`; and cheaper beer baselines unable to replace missing selected-lane figures. Existing default-pint order and authority tests stay. Existing soft-drink amount-order test needs intentional contract reconciliation after the new RED/native proof, rather than deletion to suppress a failure.

`__tests__/mapVenueListComponent.test.ts` already exercises the optional sort-control guard and labels through rendering. Add a mounted lane-switch integration at the existing Map/List seam if needed: choose pint Cheapest, select Gin, observe actual neutral rows/control/count, then return to pints. A static markup case alone does not prove state transition, keyboard interaction or callback suppression. Keep existing area neutral-order and `listedPriceComparison` tests; Plan fixed evidence boosts are unaffected.

## Native acceptance

First unchanged RED: real category GET must establish Brownswood £4.20/25ml and Scolt Head £4.00/unknown, with any actual community override disclosed; both actual IDs must be present in the viewport List. Exercise Cheapest natively and record actual order, row text and detail provenance. Failure to establish that pair is SETUP UNPROVED, not a passing ranking result.

After the authorised patch/fresh build, repeat at 390 and 1440: pints Cheapest works; selecting Gin exposes neutral discovery with no unsupported Cheapest claim; both quote amounts/serving disclosures remain readable; each native row opens the correct venue/source; returning to beer restores supported sorting. Capture truncated-count wording, focus/selection and overflow with real metadata. No nested source links inside the row's selection button; the venue detail already owns clickable source attribution. If metadata wraps poorly, fix measured layout in its existing owner, not with a new renderer.

Wine's explicit ml records currently use base IDs, so do not fabricate a curated wine native pair or count the unranked base List as proof of this curated comparator. The pure regression can cover the accepted wine data shape; native wine coverage requires a real eligible pair. Only the owner schedules tests/build/browser in a granted slot. No budgets or assertions are relaxed.
