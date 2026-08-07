# Outings Wave 2 — execution queue

> Status: **SHIPPING** (2026-08-07). Next product slices after the Fable overnight catalogue ([`FABLE_REVIEW_ITERATION.md`](./FABLE_REVIEW_ITERATION.md)).
> Trunk remains [#817](https://github.com/Singularityszn/pubmax/pull/817). Do **not** reopen [#816](https://github.com/Singularityszn/pubmax/pull/816) WhatsApp, [#829](https://github.com/Singularityszn/pubmax/pull/829)/[#832](https://github.com/Singularityszn/pubmax/pull/832) night-OS pin trust / first-price, or re-ship coffee taxonomy / sheet lens / scrapers already opened.

---

## Goal

Make outing jobs **reachable and measurable** on the map and in plan ranking, without inventing coffee prices or hard-filtering Spoons into unsatisfiable routes.

Physics still holds: corroboration before paint; no demo seed for empty coffee views; captain applies `0082`.

## Already shipping (do not duplicate)

See Fable checklist: #821–#828, #830, #833–#834, #836, #819/#831, #825. Prefer #828 over #826 for sheet lens.

## This wave (ranked)

### W2-A — Map drink chips include outing lenses
**Branch:** `cursor/drink-shape-outing-chips-dd0b`  
**Base:** `cursor/first-principles-outings-plan-dd0b`  
**Job:** Add `coffee`, `alcohol-free`, and `soft-drink` to the compact `DrinkShapeChips` strip (or an honest progressive second strip that never crowds the resting toolbar). Same `drinkCategory` lens as `/map?drink=`.  
**Done when:** vitest + `e2e/drink-chip-controls.spec.ts` green; VOICE-clean accessible names.

### W2-B — Price submit follows the active lens
**Branch:** `cursor/price-submit-lens-default-dd0b`  
**Base:** outings tip  
**Job:** When the map drink lens is a submittable non-beer category, the price form preselects it; `price_submit_viewed` / heading copy is category-aware (not always beer / “What’s it tonight?” for coffee).  
**Done when:** unit tests pin default category from lens; no seeded prices.

### W2-C — Plan ranking soft-boosts quiet + coffee
**Branch:** `cursor/plan-occasion-rank-signals-dd0b`  
**Base:** tip of #827 (chip honesty) or outings tip after merge  
**Job:** `atmosphere: quiet` gets a positive boost from real amenities / quietHours (not only −2 on music/sports). Coffee / daytime occasions soft-prefer corroborated coffee `MapLensPrice` the way `zeroProof` prefers AF. Food needs stay honest (amenities.food only).  
**Done when:** `__tests__/planGenerationRanking.test.ts` pins boosts; no invented prices.

### W2-D — Analytics for lens + describe chips
**Branch:** `cursor/outing-lens-analytics-dd0b`  
**Base:** outings tip or `main`  
**Job:** Closed-enum events for drink-lens select/clear and describe-first chip pick (category / chip id only; no free text). Update `docs/METRICS_FUNNEL.md`.  
**Done when:** `__tests__/analyticsEvents.test.ts` pins allow-lists.

### W2-E — Map Spoons directory filter
**Branch:** `cursor/map-spoons-directory-filter-dd0b`  
**Base:** tip of #830 (reuse `wetherspoonsMatch`) or outings tip with helper copied carefully  
**Job:** Map filter narrows to curated venues matched to the first-party Spoons directory; honest empty state; no fake menu prices; does not change generate ranking.  
**Done when:** filter unit tests + empty copy VOICE-clean.

### W2-F — Coffee borough density ops (optional stretch)
**Branch:** `cursor/coffee-borough-density-ops-dd0b`  
**Base:** outings tip  
**Job:** Local/keyless script reports coffee (and optionally AF / soft-drink) corroborated coverage by borough; docs name one seed borough and the no-seed-prices rule. Avoid rewriting #832 pint first-price UI.  
**Done when:** script exits 0 on fixtures; no network in tests.

## Execution rules

1. One concern per PR; stack notes in the PR body when depending on #817 / #827 / #830.
2. No invented biography, fake counts, or Wetherspoons Order & Pay reverse.
3. Captain applies migrations — agents ship SQL only (`0082` still captain).
4. Do not touch `AuthProvider` token-fragment paths.
5. Commit + push + open/update draft PR per branch before claiming done.

## Opened PRs (this wave)

| Item | PR |
|---|---|
| Plan doc | [#839](https://github.com/Singularityszn/pubmax/pull/839) |
| W2-A drink outing chips | [#843](https://github.com/Singularityszn/pubmax/pull/843) |
| W2-B price-submit lens default | [#842](https://github.com/Singularityszn/pubmax/pull/842) |
| W2-C quiet/coffee ranking | [#841](https://github.com/Singularityszn/pubmax/pull/841) |
| W2-D lens/chip analytics | [#845](https://github.com/Singularityszn/pubmax/pull/845) |
| W2-E Spoons map filter | [#844](https://github.com/Singularityszn/pubmax/pull/844) |
| W2-F coffee borough ops | [#847](https://github.com/Singularityszn/pubmax/pull/847) |

## Success signals

1. A phone user can set a coffee / AF / soft-drink lens from the map chip strip without Discover.
2. Logging a coffee price after a coffee lens does not start on beer.
3. “chill Wetherspoons” and “quiet afternoon” plans prefer quieter / Spoons / coffee-priced stops when evidence exists, without 422ing empty areas.
4. PostHog (consent-gated) can count non-pint lens usage and chip picks.
