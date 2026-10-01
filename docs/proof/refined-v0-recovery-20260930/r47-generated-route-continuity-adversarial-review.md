# Continuity v2 and incremental projection adversarial source review

Status: SOURCE REVIEW ONLY. No runtime, maintained source/test changes, or completion-share repair. Reviewed full v2 replay packet and current Root applied V1 plus proposed incremental projection.

## Verdict

Incremental projection resolves the actual nullable `NightContext.drinkCategory` incompatibility: zero-proof projects only `{zeroProof:true}`, non-null non-beer category projects closed category plus false, beer/absent category projects null. Memo already depends on `generatedPricing?.context`. No casts, widened type, prices/proof/private context/GPS URL fields, or asynchronous ownership changes. Full v2 is a replacement from original before pins; current V1 Root must use incremental hunk, not apply full replay atop V1.

No source-supported late-price-completion blocker found for Clear/live edit/Reverse: category fetch completion changes `listedDrinkPrices` and `byVenueId`, never the coordinator. `replaceBuiltIds` retires pricing (coordinator61-64); Clear uses it (PubMap4218). Live edit sets `readCurrentQuotes:false`, clears quote/budget snapshots (coordinator54-59), so completion cannot repopulate route quotes. Reverse changes order only (coordinator65-67); presentation validates unique same-ID set before using quotes (RoutePanel92-106). `currentMapRoutePricing` only rereads exact route IDs and same requested category through existing selected-evidence cleaner (coordinator26-37). Missing/unavailable current data keeps null round budget, rather than canonical Pint money.

## Concrete source edge requiring separate native proof

Public route intent can be retired by deferred curated-crawl hydration even without a route edit. `mapSeedNeedsCuratedCrawlLookup` (lib/mapSeedCrawlPolicy.ts5-8) bypasses only `isDrinkShapeArrival`; that predicate (lib/mapArrival.ts4-5) recognises independent `drink=`/`cocktails=1`, not new `routeDrink`/`routeLow`. With explicit route metadata and pubs matching a catalog crawl (or valid crawl selector), `curatedCrawlHydrationFromSeed` returns canonical crawl (mapSeedCrawl.ts99-115). PubMap1738 calls `replaceBuiltIds`, which clears pricing/category even when IDs are unchanged. Debounced URL sync then removes route metadata; RoutePanel can return to manual Pint presentation. This is a reachable source composition gap, not demonstrated native failure and not evidence that original generated Vodka three-stop cohort matches the catalog.

Exact committed London example, not executed:

`/map?mode=build&pubs=venue-1ufn31x,venue-1t8siin,venue-xiesdn,venue-phqazo,venue-15i2wst&routeDrink=vodka`

These are the ordered `victorian-soho` IDs at `lib/curatedCrawls.ts47-60`. No `drink=` or `cocktails=1` means `isDrinkShapeArrival` false; five built IDs make seed policy true. `resolveSeededCuratedCrawl` matches the exact ordered list (`mapSeedCrawl.ts14-23,28-39`). No venue IDs or offers invented; example asserts route category ownership, not existence of Vodka quotes at these pubs. Existing snapshot guard does not include public route intent; absent other reader action its unchanged route/filters allow same-ID hydration, then `replaceBuiltIds` sets pricing null. Actual browser schedule remains UNRUN.

Smallest future regression: actual existing curated crawl IDs with explicit routeDrink=vodka and no independent lens; before/after real catalog completion must keep category and unknown round money while same IDs are hydrated. Preserve explicit Clear/manual replacement resetting authority. Existing mapSeedCrawl/public coordinator fixtures offer unit seam; native catalog resolution still required. No new source/test work performed here.

## Scope and limits

Quote reread intentionally selects current eligible category representative, not historical selected serving/quote/proof. It preserves existing corroborated-community/listed standing and freshness helpers; unavailable/truncated index can omit current evidence. Independent lens can differ from route category. No amount comparison or serving guess introduced. URL arrival is captured at mount; this review does not establish same-mounted arbitrary external query navigation or persistence beyond original Reload/fresh-context acceptance. Root owns completion-share gap separately.

Parent-reported actual focus117/117 PASS and TS2345 nullable-category failure concern V1. They do not prove incremental typecheck, fresh native Reload/Copy URL, or broad final gates. No runtime checks performed for this receipt. Strict Stop1 release remains separate packet and corrected mounted tests untouched.

## Captured source

Root HEAD at read: `6f7be486df3a35a00fbec410fdc6cb4bfde37ae2`. Working-tree hashes matter because overlays are uncommitted.

| Path | SHA256 |
| --- | --- |
| `components/PubMap.tsx` | `bdb7171ad47bda90fde04d83dfd1bfaaabbfb55057b6a21dfbaf3c838fdc1642` |
| `components/map/pubmap/useMapPlanCoordinator.ts` | `9bd3b2860f9a1622605ab1407bcb30bc069e53bfc32d682bdccd8fa001a0a6b6` |
| `components/map/useCrawlUrl.ts` | `67495214f85eeea3ddf0f13a64086cf4234e975d15618183b6aeb7205e89602f` |
| `lib/crawlUrl.ts` | `eb43872e1478c6d239d5a98efd2dd43990966ca286467371b2a208e6f71bd4e6` |
| `components/map/useCommunityPrices.ts` | `b4a27c9f6aa726b6eb2de90dc1c58ab73e293fd7652353ee2522a6429547eb98` |
| `components/map/RoutePanel.tsx` | `fb2c4801277276124c34add073588e2b63ebd20aa4b2173969c829706c131ab7` |
| `lib/mapSeedCrawlPolicy.ts` | `1d796db597c639d544aeeb1f4370ba6d7bc5c37e828f37218b894632bdbec24c` |
| `lib/mapSeedCrawl.ts` | `9784de7bf7e46ecbc64a2dba7b54e61b9ff038701c4a6487c52548a5e7315bf9` |
| `lib/mapArrival.ts` | `ce87c252a913025e8de6bd22cdbb79c9d6b0aa940b367a49c7d2eae191305d06` |
| `lib/mapExperienceLens.ts` | `02326aa2035a8f90696be0fa7d446b029bab68bf765bb32c13aae3996280cc85` |
| `lib/planSelectedDrinkPriceEvidence.ts` | `0cb2ecd55dc6479ecf9f77efc1d662bdc0a0e365e35ca9aae040ee5611f03706` |

Reviewed projection patch SHA256: `e2ecfdaa897dd0058f1d1da04e17cc40e5f2603614e3c561b2813225b35a012a`.
Full replay v2 SHA256: `35eb2f3ba947c0a14e8b0aa66191333447e93720b11c9f1089e2c10f27a6cd5c`.
