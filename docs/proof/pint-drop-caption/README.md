# A Pint Drop is a live contribution, and only a closed lane is a snapshot

Final verification report, section 12 (c): after PR #1555 the venue Drinks list
captioned public Pint Drop rows `Snapshot from 1 Sept 2026`. A drinker's log is
a dated observation, not a snapshot of anything.

## Cause

`components/drinks/DrinkMenu.tsx` chose the caption by falling through: the
bundled dataset lane took the price-authority window, and **everything else**
took the snapshot words. A Pint Drop row is not the dataset either, so it took
them too.

The caption now reads the **declared** lane. `SNAPSHOT_CAPTION_LANES` is the
closed set (`drink-price-update`, the lane the captain ruled closed on
2026-09-05); every other row is measured against
`PINT_DATASET_PRESENTATION_BUDGET_DAYS`, the shared price-authority window.

## Method

Local production build on `http://localhost:3111` (`PUBMAX_E2E_KEYLESS=1`,
`NEXT_DIST_DIR=.next-prod`), `/map?sel=venue-1vle947` (The Sir Christopher
Hatton), Drinks tab then the Drinks tile. The keyless server holds no Pint
Drops, so `GET /api/pint-drops` is answered with the two rows the report names
(`Lager £4.50` seen 1 Sept 2026, `Half of lager £2.60` seen 5 Sept 2026). The
`before` shots are the same fixture against a build of the parent commit's
`DrinkMenu.tsx`.

## Measurement, read off the rendered rows

| Width | Before | After |
| --- | --- | --- |
| 390x844 | `Lager £4.50 PINT DROP Snapshot from 1 Sept 2026` | `Lager £4.50 PINT DROP Seen 1 Sept 2026` |
| 768x1024 | `Half of lager £2.60 PINT DROP Snapshot from 5 Sept 2026` | `Half of lager £2.60 PINT DROP Seen 5 Sept 2026` |
| 1440x900 | both rows `Snapshot from` | both rows `Seen` |

Shots: `before-390x844.png`, `before-768x1024.png`, `before-1440x900.png` and
their `after-` twins.

The overlay (`drink-price-update`) rows keep PR #1555's dated, warning-free
`Snapshot from` caption, and the caption still holds its day unbreakable, so
the design pass of that PR stands.
