# Taking a night back, and three phone defects from the contribution battle test

Proof for D06, L01, L02 and L05 of the contribution and memory battle test of
5 September 2026 (`data/contribution-battle-test/report.md`, built SHA
`2d00af6d2`). Every measurement below is from a production build of this
repository, light theme, reduced motion, device scale 2, at 390x844, 768x1024
and 1440x900.

- `before/` is `origin/main` at `0cab8aed9`.
- `after/` is this branch.

Both builds carry the keyless E2E environment, so a browser auth graph exists
and the signed-in surfaces render; the account, the handle, the mission read and
the price write are answered by route doubles in the capture script, and the
Pint Drop read is answered with one logged-once £6.50 for the plaque shots.

## What each pair shows

| shot | defect | before | after |
| --- | --- | --- | --- |
| `receipt-*` | L02, mission card | the card "Check the beer price at …" plus "Not now" still stands above the receipt for the price just logged | the card is gone, the receipt stands alone |
| `receipt-390` | L01, credit sentence | "Counted under @night_owl on the contributor record." splits into three cells | one paragraph across the row, with "See your impact" under it |
| `plaque-*` | L05, peek price plaque | the plaque stretches the whole grid column with the figure at its right end | the plaque hugs its figure |
| `studio-*` | D06, removal | the studio can create a Memory and a Moment and remove neither | a removal shelf with an inline confirm |

## Measured

Numbers are CSS pixels read off `getBoundingClientRect` in the same run that
took each shot; the full record is `notes.json` beside the images.

| measure | width | before | after |
| --- | --- | --- | --- |
| mission card on screen after the log | 390, 768, 1440 | yes | no |
| `.vpsubStampHint` display | 390, 768, 1440 | `flex` (its words are three flex items) | `block` |
| credit sentence box | 390 | 266px of a 266px row, split into cells | 266px paragraph, link beneath |
| credit sentence and link | 1440 | one row | one row (unchanged) |
| peek plaque plate against its figure | 390 | 121.6px plate, 40.8px figure | 71.9px plate, 40.8px figure |
| plaque painted above its own row | 390 | 1.6px | 0.9px |
| removal shelf in the studio | 390, 768, 1440 | absent | present, with the inline confirm |
| `document.documentElement.scrollWidth` in the studio | 390 | 464px against a 390px viewport (the first cut of the shelf) | 390px |

The peek plaque is phone-only: at 768 and 1440 the sheet is the drawer and the
`plaque-768` / `plaque-1440` shots are the same journey at those widths, where
the peek summary does not render.

## What the e2e now holds

- `e2e/price-evidence-missions.spec.ts`: the card goes on the log, the sentence
  is prose at 390, and the sentence and its link share one row at 1440.
- `e2e/mobile-venue-sheet-tabs.spec.ts`: the plate against its figure, the paint
  above the row, and the clearance under the sheet header.
- `e2e/night-memory-removal.spec.ts`: the two beats, the request that only the
  confirm spends, and the width the studio keeps.

## Method

`zz-shots.mjs` in the worktree (scratch, not committed) drives Chromium through
Playwright against `next start` on each build: it seeds the E2E session in
`localStorage`, answers the identity, mission, price-submit, pint-drop and
night-memory reads, opens the venue sheet at `/map?sel=…`, logs £4.20 through
the composer, switches to the Drinks tab for the plaque, and opens
`/u/you#night-memories` for the studio with one Memory and two Moments.
