# drink_price_updates is a static snapshot

Captain ruling, 5 September 2026. The `drink_price_updates` lane sat 27 hours past
its 336 h staleness budget and could not be refreshed: its only permitted source
(Wetherspoons) publishes no per-drink web prices, so no run of the retrieval
workflow can advance the file. A budget there was a promise nobody could keep, and
the lane reported stale for ageing exactly as it was designed to.

The lane is now a closed snapshot. It shows its collection date, raises no stale
finding, and gains no new source.

## What changed

| Where | Before | After |
| --- | --- | --- |
| `data/freshness_registry.json` | `class: "episodic"`, `stalenessBudgetHours: 336` | `class: "snapshot"`, `stalenessBudgetHours: null` |
| `GET /api/freshness`, `npm run check:freshness` | `stale` | `snapshot`, dated, no breach |
| Venue Drinks caption (overlay row) | `Seen 11 Jul 2026`, or `Last seen` past 14 days | `Snapshot from 11 Jul 2026` |

The caption words come from `SNAPSHOT_CAPTION_PREFIX` / `formatSnapshotFrom` in
`lib/dataFreshness.ts`, the one composer the bundled pint dataset's own
`formatPintDatasetSnapshot()` also reads, so a drinker, a page caption and the
freshness audit cannot drift into three vocabularies.

The bundled pint dataset lane is untouched: it IS re-collected, so its rows keep
`Seen` / `Last seen` measured against the price-authority window. Both lanes appear
in one menu, which is the point - two lanes, two claims.

## Measurement

`node scripts/check_freshness.mjs`, this branch:

```
SNAPSHOT   drink_price_updates      363.4h  / -    static snapshot: the rows describe the day they were collected and nothing may lawfully advance them
```

Before the change the same row read `STALE ... over the 336h budget`.

## Screenshots

Production build (`NEXT_DIST_DIR=.next-prod`), `/map?sel=venue-1r4e6my`
(Crown, Covent Garden - 103 overlay drink rows), Drinks tab, Beer menu.

- `after-390x844.png`
- `after-768x1024.png`
- `after-1440x900.png`

## Design pass

The first render broke the caption as `Snapshot from 11 Jul` / `2026`, leaving the
year alone on a line of its own inside the 9rem caption column. The caption must
wrap rather than truncate (a cut date cuts the whole claim), so the fix keeps the
DAY unbreakable instead: `.drinkObservationAge time { white-space: nowrap }` in
`components/drinks/drinkMenu.css` moves the break to after the words. Verified at
all three widths above: two balanced lines, no truncation, no sideways scroll.
