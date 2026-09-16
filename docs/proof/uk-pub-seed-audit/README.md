# UK pub seed coverage proof

**Scope:** issue 1623, phase 1. **Audited base:** `origin/main` at `47996d4`; the seed and published UK base artifacts are on main, and the UK base pin's no-price behaviour is covered by focused tests here. **Revalidated:** `2026-09-16T00:22:46Z`.

## Result

The UK pub seed is complete at the requested 38,215 normalized pubs and is already present in the UK base map on `main`. The seed was fetched at `2026-07-26T01:07:30Z` (`generatedAt` in `data/osm/uk/chunks.json`) and a count-only Overpass check was replayed at `2026-09-16T00:22:46Z`. It returned 38,526 UK `amenity=pub` node/way elements against the 38,500 distinct elements the seed fetched, so the upstream total grew by a **net 26 elements** over that 52-day interval. THAT NET FIGURE IS NOT A COUNT OF PUBS WE ARE MISSING: a count-only check returns one scalar, in which additions, deletions and retags (to `amenity=bar` or `disused:amenity=pub`) cancel, so it cannot bound the absolute set of upstream pubs not fetched. Only fetching the upstream id set and diffing it against the seed would, and that is a re-fetch this PR does not make. Separately, 285 of the fetched elements carry no OSM name and are excluded by the current product rule, which is a captain decision held outside this repository; they are not an upstream gap. Both totals compare like for like only against the raw element count, because the Overpass query carries no name filter while the 38,215 seed is named-only. Whether to refresh the seed is a captain decision raised outside this repository's tracker; no GitHub issue is filed for it yet. The seed is not re-fetched in this PR. The raw Overpass files contain 38,511 element occurrences, which reconciles to the normalized count after 11 shared-grid-edge duplicates and 285 valid raw elements without an OSM name are accounted for. The published base manifest contains all 38,215 pub ids, plus 7,190 separately harvested bar rows. Coverage is complete on main. No UK base pub carries a price on main or here, so criterion 4 holds on both, and the remaining phase-1 obligations are the audit artifact and the final PR gate.

## 1. Seed count and raw chunk count

| Check | Result |
| --- | ---: |
| `data/osm/uk/uk_osm_pubs.json` `count` | **38,215** |
| `data/osm/uk/uk_osm_pubs.json` `pubs` list | **38,215** |
| Distinct normalized OSM ids | **38,215** |
| Issue target | **38,215** |
| Current count-only Overpass result | **38,526** |
| Net upstream growth since the seed fetch (38,526 - 38,500) | **+26 / +0.07%** (net, not a missing-pub count) |
| `data/osm/uk/raw/chunk_*.json` files | **132 / 132** |
| Sum of raw `elements` across chunks | **38,511** |
| Distinct raw `(type,id)` elements | **38,500** |
| Duplicate raw edge occurrences | **11** |
| Distinct raw elements dropped by normalization | **285** (all had no name; coordinates were valid) |

The raw total is therefore `38,500 - 285 = 38,215` normalized pubs, while the file-occurrence total is `38,500 + 11 = 38,511`. `data/osm/uk/chunks.json` reports the same 132 chunks, 66 chunks with data, `missingChunks: []`, and `elements: 38511`. The fetch query is `amenity=pub` nodes and ways clipped to UK relation 62149, using the bbox `[49.8, -8.7, 61.0, 1.9]`.

The current upstream check was one count-only GET at `2026-09-16T00:22:46Z` to `https://overpass.private.coffee/api/interpreter`, using the same relation and bbox:

```overpass
[out:json][timeout:90];
area(id:3600062149)->.uk;
(
  node["amenity"="pub"](area.uk)(49.8,-8.7,61.0,1.9);
  way["amenity"="pub"](area.uk)(49.8,-8.7,61.0,1.9);
);
out count;
```

Overpass returned `nodes=16,594`, `ways=21,932`, `total=38,526`. That count carries no name filter, so it compares against the **38,500** distinct elements fetched above rather than the named-only 38,215: the upstream total has grown by a **net 26 elements (0.07%)** since the seed was fetched at `2026-07-26T01:07:30Z`. A count-only check cannot bound the absolute set of upstream pubs not fetched, because one scalar hides how many elements were added against how many were deleted or retagged in the same 52 days; a pack that gained 150 and lost 124 returns this same 38,526. Bounding it needs the upstream id set fetched and diffed against the seed, which is a re-fetch. The 285 unnamed fetched elements are held out by the product rule in section 4 and are already on this side of the fence, so they are not part of any upstream figure here. This audit sets no refresh threshold, and none exists elsewhere in the tree. Whether to refresh the seed is a captain decision raised outside this repository's tracker; no GitHub issue is filed for it yet.

## 2. Geographic coverage and gaps

The raw grid covers every UK nation represented by this query: England (including the South West, South East/London, Midlands, East Anglia, North West, Yorkshire and the North East), Wales, Scotland (mainland and populated island cells), and Northern Ireland. There is no missing UK nation or named populated region indicated by the raw manifest. `missingChunks` is empty, so the zero-result cells below are not failed fetches; they are empty grid cells in the padded bbox, mostly sea or unpopulated outer extent.

There are 66 non-empty cells:

- `lat49.80_lon`: `-0.70`, `-1.70`, `-2.70`, `-3.70`, `-4.70`, `-5.70`, `-6.70`, `0.30`
- `lat50.80_lon`: `-0.70`, `-1.70`, `-2.70`, `-3.70`, `-4.70`, `-5.70`, `0.30`, `1.30`
- `lat51.80_lon`: `-0.70`, `-1.70`, `-2.70`, `-3.70`, `-4.70`, `-5.70`, `0.30`, `1.30`
- `lat52.80_lon`: `-0.70`, `-1.70`, `-2.70`, `-3.70`, `-4.70`, `-5.70`, `0.30`, `1.30`
- `lat53.80_lon`: `-0.70`, `-1.70`, `-2.70`, `-3.70`, `-4.70`, `-5.70`, `-6.70`, `-7.70`, `-8.70`
- `lat54.80_lon`: `-1.70`, `-2.70`, `-3.70`, `-4.70`, `-5.70`, `-6.70`, `-7.70`
- `lat55.80_lon`: `-2.70`, `-3.70`, `-4.70`, `-5.70`, `-6.70`
- `lat56.80_lon`: `-2.70`, `-3.70`, `-4.70`, `-5.70`, `-6.70`, `-7.70`
- `lat57.80_lon`: `-3.70`, `-4.70`, `-5.70`, `-6.70`, `-7.70`
- `lat58.80_lon`: `-3.70`
- `lat59.80_lon`: `-1.70`

There are 66 zero-element cells. These are the exact gaps in the 1-degree fetch grid, not missing data within a fetched cell:

- `lat49.80_lon`: `-7.70`, `-8.70`, `1.30`
- `lat50.80_lon`: `-6.70`, `-7.70`, `-8.70`
- `lat51.80_lon`: `-6.70`, `-7.70`, `-8.70`
- `lat52.80_lon`: `-6.70`, `-7.70`, `-8.70`
- `lat53.80_lon`: `0.30`, `1.30`
- `lat54.80_lon`: `-0.70`, `-8.70`, `0.30`, `1.30`
- `lat55.80_lon`: `-0.70`, `-1.70`, `-7.70`, `-8.70`, `0.30`, `1.30`
- `lat56.80_lon`: `-0.70`, `-1.70`, `-8.70`, `0.30`, `1.30`
- `lat57.80_lon`: `-0.70`, `-1.70`, `-2.70`, `-8.70`, `0.30`, `1.30`
- `lat58.80_lon`: `-0.70`, `-1.70`, `-2.70`, `-4.70`, `-5.70`, `-6.70`, `-7.70`, `-8.70`, `0.30`, `1.30`
- `lat59.80_lon`: `-0.70`, `-2.70`, `-3.70`, `-4.70`, `-5.70`, `-6.70`, `-7.70`, `-8.70`, `0.30`, `1.30`
- `lat60.80_lon`: `-0.70`, `-1.70`, `-2.70`, `-3.70`, `-4.70`, `-5.70`, `-6.70`, `-7.70`, `-8.70`, `0.30`, `1.30`

The exact raw chunk list is retained here because the grid is the auditable coverage unit. A zero-element cell must not be interpreted as evidence that the UK seed omitted a pub: the normalized pack has 38,215 unique ids and the serving shards cover every one of them.

## 3. Published UK base shards

`public/data/uk_base/manifest.json` points at one immutable generation with **617** shard files and **45,405** rows:

- **38,215 pubs** from `data/osm/uk/uk_osm_pubs.json`;
- **7,190 bars** from the separate drink-venue pack.

Coverage checks against the committed generation found **38,215 / 38,215** seed OSM references in the shards, **0** missing pub references, and **0** rows outside their manifest bbox. The additional 7,190 references are the intentional bar layer, not duplicate pub rows. Thus the shards cover the whole *seeded UK pub set*; empty parts of the geographic bbox have no pub row to ship.

The builder enforces a **150 KiB (153,600 byte) per-shard** ceiling. The largest published shard is `51.500_-0.125.json` at **124,916 bytes (122.0 KiB, 81.3% of the ceiling)** and 1,341 rows. The published generation has 613 cells at `0.25° × 0.25°` and four dense central-London cells at `0.125° × 0.125°`; no cell exceeded the ceiling. The serving grid's total shard payload is **3,849,171 bytes (3.67 MiB)**, below the builder's 5 MiB total limit. The manifest is **45,747 bytes**, below its 64 KiB limit.

## 4. Prices and the no-price map path

For the issue's 38,215-pub UK seed:

- **0 pubs have a price**;
- **38,215 pubs have no price**.

The normalized seed has no price-like field at all. The 38,215 pub rows in the published UK base layer also have no price slot by schema. The separate 7,190 bar rows are likewise not a price source. For context only, the separate London curated slim index has 1,039 numeric `cheapestPrice` rows and 956 null rows; those 1,995 curated rows are not part of the UK OSM seed count. The 285 unnamed raw elements are deliberately excluded by `normalizeOsmPubElement`, which requires a trimmed OSM `name` and valid coordinates; this is the current product rule, not a coverage gap.

Today the map handles an unpriced UK base pub as follows:

1. `UkBasePub` has identity, name, address, coordinates, owner and kind, but no price field.
2. `ukBasePubsToGeoJSON` emits identity/display properties only. It deliberately emits no `bucket`, `cheapestPrice`, `priceLabel` or story price property.
3. `buildScene` draws the separate `uk-base-point` source with the base/unpriced icon and 0.85 opacity. Its ordinary text expression is empty, so an unpriced pub gets no price label. The base source is below the curated priced source and is not clustered into curated price donuts.
4. On the ordinary curated-pub path, `priceBucket(null)` is the neutral no-price bucket, `priceLabel` is omitted, and the no-price icon is used. The focused tests also cover an unpriced pub with one uncorroborated report: it keeps no band and no label.

The UK base path carries no price on `main` or on this branch: `ukBasePubsToGeoJSON` emits no price, no price bucket and no price label, the base pin draws `base:pub`, and the layer has no price-driven paint. Criterion 4 is therefore met, and it is met by the seed's own shape rather than by a guard.

The Spoons Value lens is the one place a base pin takes a colour, and that colour is not a price. `UK_BASE_ICON_IMAGE_EXPR` reads `spoonsBucket`, a band cut from the units in a credited £10 round (`lib/spoonsValue.ts`), and it reaches no pint price, no price bucket and no price band. A base pub the ranking says nothing about is stamped with nothing at all, so the expression falls through to `base:pub` under the lens exactly as it does with the lens off. A first-mate reading briefly made the glyph a constant on this branch (commit `58596e9`); Captain 15 Sep 2026 withdrew that, because criterion 4 governs price colouring and a credited value lane is not a price. The recorded law is `lib/AGENTS.md` rule (4) and `docs/proof/spoonme-value-lens/` section 7. Fences: `__tests__/ukBasePubs.test.ts`, which proves an unpriced base pub outside the ranking is given nothing a pin could paint with, and `__tests__/mapSymbolCollision.test.ts`, which reads the shipped expression and its `base:pub` fallback.

## 5. Acceptance-criterion status on `main`

| Criterion | Phase-1 finding |
| --- | --- |
| 1. PR body says where the 38,215-pub seed is and what main holds | **Not yet closed as a PR artifact.** The exact statement is ready above and must be copied into the final PR body, including how the upstream figure reads: 38,526 counted on 2026-09-16 against 38,500 fetched on 2026-07-26 is a net growth of 26 elements, NOT a count of pubs missing from the map, because a count-only check cancels additions against deletions and retags; only fetching and diffing the upstream id set would bound that. 285 unnamed fetched elements are excluded by product rule rather than missing. The seed is `data/osm/uk/uk_osm_pubs.json`; raw chunks are under `data/osm/uk/raw/`; `main` holds the 617-shard generation under `public/data/uk_base/`, plus the UK place/search builders. |
| 2. UK is covered by shard cells under the per-cell budget | **Verified true on main.** All 38,215 seed ids are in the manifest generation; the largest cell is 124,916 bytes against 153,600 bytes. |
| 3. `/map` budgets before and after are in the PR body | **Not yet closed as a PR artifact.** The figures to carry forward are recorded below. |
| 4. Pubs without a price use the no-price pin, never a price colour | **True on main and here.** No UK base pub carries a price, a price bucket or a price label on either, so no price colour can reach one. The Spoons Value lens paints a base pin from `spoonsBucket`, a credited units band that is not a price and reaches no price surface; a pub outside the ranking keeps `base:pub`. Captain 15 Sep 2026 confirmed the lens keeps its band colour and withdrew the branch's earlier constant-glyph change. |

## `/map` figures to carry into the final PR body

The tracked current ceilings in `perf/route-budgets.json` are **150 ms server render, 3,400 KB decoded JS, 160 requests, and 900 ms LCP** for `/map`; its pin-readiness target is 2,500 ms. The tracked before/after regression evidence in `docs/PERFORMANCE_BUDGETS.md` records **331 requests and 980 ms LCP before the bounds fix**, then **125 requests and 576 ms LCP after the fix**. This phase changed no product behaviour and no route budget, so there is no new after measurement: the final PR body must state these existing before/after measurements and the current ceilings, rather than implying that this audit changed `/map`.

## Source paths and verification basis

- Seed/raw: `data/osm/uk/uk_osm_pubs.json`, `data/osm/uk/raw/`, `data/osm/uk/chunks.json`, `scripts/fetch_uk_osm_pubs.mjs`.
- Serving: `scripts/build_uk_base_shards.mjs`, `scripts/lib/ukBaseGrid.mjs`, `public/data/uk_base/manifest.json`, `public/data/uk_base/README.md`.
- No-price behavior: `lib/ukBasePubs.ts`, `components/map/canvas/buildScene.ts`, `components/map/canvas/geojson.ts`.
- Focused fences: `__tests__/ukBasePubs.test.ts`, `__tests__/ukBaseBars.test.ts`, `__tests__/canvas-geojson.test.ts`, `__tests__/mapSymbolCollision.test.ts`.
- Budgets: `perf/route-budgets.json`, `docs/PERFORMANCE_BUDGETS.md`.
