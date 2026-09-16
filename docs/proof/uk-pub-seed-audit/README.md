# UK pub seed coverage proof

**Scope:** issue 1623, phase 1. **Audited base:** `origin/main` at `47996d4`; the seed and published UK base artifacts are on main, while the Spoons no-price correction is implemented on this branch at `58596e9` and covered by focused tests. **Revalidated:** `2026-09-16T00:22:46Z`.

## Result

The UK pub seed is complete at the requested 38,215 normalized pubs and is already present in the UK base map on `main`. A current count-only Overpass check returned 38,526 UK `amenity=pub` node/way elements, 311 above the seed (0.81%). Those 311 UK pubs exist upstream and are not on the map. The audit measured that gap and put it to the captain rather than setting a rule for itself, because no owner in this tree holds a freshness budget for the UK OSM seed. Captain 15 Sep 2026 accepted the measured 0.81% delta as under 2%, judged the seed current enough and stopped there, so no refresh is needed in this PR and the seed is not re-fetched. The raw Overpass files contain 38,511 element occurrences, which reconciles to the normalized count after 11 shared-grid-edge duplicates and 285 valid raw elements without an OSM name are accounted for. The published base manifest contains all 38,215 pub ids, plus 7,190 separately harvested bar rows. Coverage is complete on main. Main still has the Spoons Value no-price pin gap; this branch already carries the focused correction, so the remaining phase-1 obligations are the audit artifact and final PR gate.

## 1. Seed count and raw chunk count

| Check | Result |
| --- | ---: |
| `data/osm/uk/uk_osm_pubs.json` `count` | **38,215** |
| `data/osm/uk/uk_osm_pubs.json` `pubs` list | **38,215** |
| Distinct normalized OSM ids | **38,215** |
| Issue target | **38,215** |
| Current count-only Overpass result | **38,526** |
| Difference from issue target | **+311 / +0.81%** |
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

Overpass returned `nodes=16,594`, `ways=21,932`, `total=38,526`. The seed is **0.81% below** that current count, a measured gap of **311 UK pubs**. The audit sets no refresh rule of its own, and no rule for this seed exists elsewhere in the tree. Captain 15 Sep 2026 accepted this delta as under 2% and judged the seed current enough, so it is not re-fetched here.

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

The UK base path is neutral while the lens is off on both `main` and this branch: `ukBasePubsToGeoJSON` emits no price, bucket or price label, the base pin draws `base:pub`, and the layer has no price-driven paint. On `main` the Spoons Value path stamped `spoonsBucket` on a ranked base pub and `UK_BASE_ICON_IMAGE_EXPR` concatenated `drink:pint-<bucket>`. That was the price-band sprite family, so an unpriced base pub could receive a colour even though the value lane is not a pint-price claim. The separate `spoonsLabel` is a credited units/value label, and it did not make the coloured glyph compliant. Criterion 4 therefore passed on the ordinary path and failed on main; branch commit `58596e9` makes `UK_BASE_ICON_IMAGE_EXPR` the constant `base:pub` under the lens as well, and adds the focused regression test. The map key follows: its grey row reads "Unranked or unpriced", because a neutral pin under this lens is either a pub the ranking says nothing about or a ranked base pub that carries no price. This distinction is recorded in `lib/ukBasePubs.ts`, `components/map/canvas/buildScene.ts`, `__tests__/ukBasePubs.test.ts`, `__tests__/canvas-geojson.test.ts`, and `__tests__/mapSymbolCollision.test.ts`.

## 5. Acceptance-criterion status on `main`

| Criterion | Phase-1 finding |
| --- | --- |
| 1. PR body says where the 38,215-pub seed is and what main holds | **Not yet closed as a PR artifact.** The exact statement is ready above and must be copied into the final PR body. The seed is `data/osm/uk/uk_osm_pubs.json`; raw chunks are under `data/osm/uk/raw/`; `main` holds the 617-shard generation under `public/data/uk_base/`, plus the UK place/search builders. |
| 2. UK is covered by shard cells under the per-cell budget | **Verified true on main.** All 38,215 seed ids are in the manifest generation; the largest cell is 124,916 bytes against 153,600 bytes. |
| 3. `/map` budgets before and after are in the PR body | **Not yet closed as a PR artifact.** The figures to carry forward are recorded below. |
| 4. Pubs without a price use the no-price pin, never a price colour | **Not true on main; implemented on this branch.** The ordinary UK base path is neutral, while main's Spoons Value path mapped an unpriced base pub's `spoonsBucket` to `drink:pint-<bucket>`. Branch commit `58596e9` removes that coloured fallback and adds the focused regression test, and the Spoons map key's grey row now reads "Unranked or unpriced" so it never calls a ranked base pub unranked. |

## `/map` figures to carry into the final PR body

The tracked current ceilings in `perf/route-budgets.json` are **150 ms server render, 3,400 KB decoded JS, 160 requests, and 900 ms LCP** for `/map`; its pin-readiness target is 2,500 ms. The tracked before/after regression evidence in `docs/PERFORMANCE_BUDGETS.md` records **331 requests and 980 ms LCP before the bounds fix**, then **125 requests and 576 ms LCP after the fix**. Phase 1 made no product change, so there is no new after measurement: the final PR body must state these existing before/after measurements and the current ceilings, rather than implying that this audit changed `/map`.

## Source paths and verification basis

- Seed/raw: `data/osm/uk/uk_osm_pubs.json`, `data/osm/uk/raw/`, `data/osm/uk/chunks.json`, `scripts/fetch_uk_osm_pubs.mjs`.
- Serving: `scripts/build_uk_base_shards.mjs`, `scripts/lib/ukBaseGrid.mjs`, `public/data/uk_base/manifest.json`, `public/data/uk_base/README.md`.
- No-price behavior: `lib/ukBasePubs.ts`, `components/map/canvas/buildScene.ts`, `components/map/canvas/geojson.ts`.
- Focused fences: `__tests__/ukBasePubs.test.ts`, `__tests__/ukBaseBars.test.ts`, `__tests__/canvas-geojson.test.ts`, `__tests__/mapSymbolCollision.test.ts`.
- Budgets: `perf/route-budgets.json`, `docs/PERFORMANCE_BUDGETS.md`.
