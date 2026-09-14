# Where these figures come from

The rows in `rows.json` and `map.json` are an import of one public report:

> **I ranked all UK Wetherspoon pubs by where £10 gets you the most drunk**
> Oliver Clegg, SpoonMe, 30 August 2026
> <https://spoonme.vercel.app/report>

## Licence status

**Unofficial analysis, no licence stated, credited and linked.**

The report states no licence and no terms. It is one person's public analysis,
so we treat it the way we treat any source we did not measure: we credit the
author and the publisher, we link the original on every surface that prints a
figure from it, we never present a figure as our own, and we keep it out of
every lane where a price of ours carries authority. One exception is membership
only: the dated import decides which pins `/tonight` counts as Wetherspoon pubs
for its one-row chain cap and label, and never decides a price.

Neither PUBMAXXING nor SpoonMe is connected to J D Wetherspoon plc.

If the author asks us to take it down, we take it down.

## Why it is imported rather than measured

Wetherspoon publishes no per-drink prices on its website. The probe is written
up in `lib/wetherspoons.ts`: the `/pub-menus/{slug}/` pages link to one
chain-wide PDF poster with no extractable prices, the WordPress REST `acf`
payload is empty, and live per-pub prices exist only inside the Order & Pay
mobile app, which is a private backend we do not read.

Measured on this tree the day of the import:

| What we hold | Rows | Rows with a drink name | Rows with a strength |
|---|---|---|---|
| `public/data/wetherspoons/pubs.json` | 824 pubs | 0 prices at all | 0 |
| `public/data/uk_prices/rows.json` | 4,355 | 0 | 0 |

Units per £10 needs a drink, a serving size and a strength. We hold none of the
three for these pubs, so there is nothing here to compute and nothing to
compare an import against.

## What we do ourselves

`scripts/spoonme/import-report.mjs` re-derives every row before writing it:

- every basket is re-costed from its own lines;
- every unit total is re-added from its own lines;
- the £10 ceiling is re-checked;
- the glass count is re-checked against the lines;
- the whole rank order is recomputed from the units.

A row whose own arithmetic disagrees is quarantined and named in the pack,
never repaired. On the imported edition, **805 of 805 rows held and 805 of 805
ranks agreed**.

## What the figures may never do

No figure in this pack may enter pin price colour, the cheapest-pint buckets, a
price band, a price standing, or the Pint Index. `__tests__/spoonsValue.test.ts`
holds the fence.

## Refresh

```bash
node scripts/spoonme/import-report.mjs
```

One fetch of the one page, with the project's own user agent and public contact
address. Nothing else is crawled.
