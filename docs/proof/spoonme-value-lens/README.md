# Spoons value: what was measured

The captain sent one link and one instruction: scrape SpoonMe's Wetherspoon
ranking into the site and mark it on the map. This is what the numbers behind
that turned out to be.

Retrieved 6 September 2026 21:31 UTC. Source sha256
`31d02f65a193c7826d76095eeca7cc21879e5b547a6cf2a6a5334fbb266d21ee`.

## 1. We cannot compute this ourselves, and here is the count

The brief asked for our own figure first, and a third party's only where our
own packs cannot answer. They cannot answer anywhere, and the gap is not close.

| Pack | Rows | With a drink name | With a serving size | With a strength |
|---|---|---|---|---|
| `public/data/wetherspoons/pubs.json` | 824 pubs | 0 (no prices at all) | 0 | 0 |
| `public/data/uk_prices/rows.json` | 4,355 | 0 | 0 | 0 |
| `public/data/drink_price_updates/latest.json` | 3,474 | 3,474 | 3,474 | 3 |

Units per £10 needs a drink, a measure and a strength. The Wetherspoon
directory carries no price by construction, because the chain publishes none on
the web: the probe is written up at length in `lib/wetherspoons.ts` (menu pages
link to a chain-wide PDF poster, the WordPress `acf` payload is empty, and live
per-pub prices sit in the Order & Pay app backend). The UK price bundle carries
only a category and a figure. The only rows in this tree with a strength are
three demo fixtures behind an opt-in flag.

The bundle holds exactly **two** rows mentioning Wetherspoon, and both are
MODELLED estimates (`lane: "estimate"`, `basis: "regional_baseline:…"`), which
by the price laws here may never speak with authority.

So the brief's own fallback branch covers 100 per cent of rows, and the honest
thing was to say so rather than model a figure and let it wear somebody else's
credit.

## 2. What we did do ourselves: re-derive every row

`scripts/spoonme/import-report.mjs` re-costs every basket from its own lines,
re-adds every unit total, re-checks the £10 ceiling, re-checks the glass count,
and recomputes the whole rank order before writing a row.

```
SpoonMe rows read      : 805
Arithmetic held        : 805
Quarantined            : 0
Our rank agreed        : 805/805
Joined to a map pin    : 788
```

The rank rule took one correction along the way. Our first pass tied on units
AND cost, which split 14 groups the source held level. Ties are on **units
alone**, because the question is what a tenner buys and having 3p left over is
not a better answer to it. With that rule the two rankings agree on every row,
which turns the agreement figure into a real check rather than a coincidence.

## 3. Identity: postcode, then pin

| Step | Result |
|---|---|
| SpoonMe row to our Wetherspoon directory, by postcode | 799 unique, 4 ambiguous (broken by name), 2 no match |
| Directory pub to a drawable map pin, inside 250 m | 788 of 805 |
| of which curated venues / national base pins | 112 / 676 |

The 17 misses are the 6 Republic of Ireland pubs plus a handful of OSM gaps.
Because 676 of 788 are base pins, the lens rides the UK base layer rather than
suspending it, and the venue row is mounted on **both** sheets.

## 4. The band: terciles were measured and rejected

The price-band law cuts a city's pints into thirds. These figures will not cut:

| Percentile | Units |
|---|---|
| p25 | 12.785 |
| p33 | 12.785 |
| p50 | 12.785 |
| p66 | 12.785 |
| p75 | 12.785 |

488 of 805 pubs (60.6 per cent) pour exactly the same round, so the first and
second terciles are the same number and a tercile band cannot separate anything.
`__tests__/spoonsValue.test.ts` runs the shared tercile rule over the shipped
figures and asserts the two thresholds are equal, so the rejection stays proved
rather than remembered.

The threshold is the modal round instead, derived from the rows: 189 pubs above
it, 488 on it, 128 below.

## 5. What it costs

| | |
|---|---|
| Map lane, fetched only when the lens is on | 29 KB |
| Full edition, read on the server only | 640 KB |
| `/spoons-value` document, gzipped | 71.8 KB |
| `/borough` document, gzipped (for scale) | 18.0 KB |
| `/pint-index` document, gzipped (for scale) | 21.2 KB |

The ranking page is heavier than its neighbours because it is 805 rows of real
data with no images and one small client component. A cold `/map` is unmoved:
the lens is off by default and nothing asks for its lane until a reader taps
the control, which an `e2e` assertion takes as a negative before the service
worker can have cached anything.

No route budget was raised. `/spoons-value` is a new route and carries no
budget row yet, because seeding one means running the sweep, which is an hour
of wall clock and belongs in its own commit rather than being invented here.

## 6. Rendered geometry

`shots/` holds `/spoons-value` at 320, 390, 768 and 1440 in light and dark, the
lens control open on the desktop map, and the venue-sheet row at every width.

Horizontal overflow is 0px at every width. The first table row lands at y=519
(320x568) and y=465 (390x844), well above the phone tab bar at y=790 and y=788.

That took two goes. The first cut carried a `Screen` lede AND an opening
paragraph, and nine filter chips that wrapped to three 44px rows, which put the
first listing at y=undefined below the fold and left a phone reader meeting no
listing at all: the same defect `/tonight` was fixed for. The lede is one short
paragraph now and the chips rail sideways on a phone. The table also lost its
fourth column: "The round" clipped to one word a line at 390px, so the round
sits with the pub it is poured in and the table reads the same at every width.

## 7. What is NOT shown here

There is no screenshot of pins painting under the lens at street zoom. The
local proof rig would not hold the lens on, the camera at street zoom and the
panel closed in one frame long enough to shoot, and a screenshot that does not
actually show the lens on is worse than none. What the pins do is held instead
by `__tests__/mapSymbolCollision.test.ts`, which asserts the shipped MapLibre
expressions directly: the base pin's `icon-image` is the constant `base:pub`
under the lens as well as off it, and its `text-field` is empty for every pub
outside the ranking.

The base pin took the curated pint sprite for its band when this proof was
first written. Captain 15 Sep 2026 (issue 1623, criterion 4) reversed that,
because a base pub carries no price and a coloured pint sprite over one tells a
reader it does. A ranked base pin now wears the no-price silhouette and the
credited units tag alone, and the band hue rides the curated pins. The key's
grey row was broadened to "Unranked or unpriced" in the same decision, because a
neutral pin is now either kind of pub. See rule (4) in `lib/AGENTS.md` and
`docs/proof/uk-pub-seed-audit/`.
