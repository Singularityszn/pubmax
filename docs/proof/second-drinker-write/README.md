# The second drinker's door on a logged-once price

Rendered proof for PR #1492 (Fable51Fix section 1). Shot against production
builds at 390x844, 768x1024 and 1440x900, device scale 2, reduced motion,
analytics consent already answered. `before-*` is `origin/main` at `94bdffd1c`;
`after-*` is this branch. The Pint Drop lane is a boundary double holding the
one public row production holds at The Sir Christopher Hatton (`tester`, Lager,
£4.50, three days old, no authority key), so the Overview reads exactly what
production reads. The measurements are `getBoundingClientRect` in CSS pixels
and sit beside each shot as JSON.

## The chip, before and after

`before-chip-<size>.png` / `after-chip-<size>.png` are the whole viewport;
`*-chip-detail-<size>.png` are the `.contributorPrice` block alone.

Before, the block ended on "Logged once, needs a second drinker" and offered
nothing. After, it carries one action, `Still £4.50?`, worded over the figure
the lane prints and seeding the composer with it (`lib/pintDropSecondDrinker.ts`).

| size | standing line (after) | door | door centre vs line centre |
| --- | --- | --- | --- |
| 390x844 | x 47, y 609, 296 x 16 | x 47, y 633, 103 x 44 | wraps under the line, left edge kept |
| 768x1024 | x 21, y 880, 612 x 16 | x 645, y 865, 103 x 44 | 887 vs 888 |
| 1440x900 | x 819, y 600, 488 x 16 | x 1319, y 586, 103 x 44 | 608 vs 608 |

The design pass flagged one composition fault in the first cut: the door sat
orphaned bottom-left under a full-width line, leaving the row's right half
empty at 768 and 1440. Fixed in `app/globals.css`: where the row can hold both,
the standing line and the door share it, claim left and action right, the way
the eyebrow and the plaque share the block's first row. At 390 the row cannot
hold both, so the door wraps under the line and keeps the left edge, the thumb
side every other action on this sheet starts from.

The pass also found and fixed a selector fault the first cut shipped:
`.firstDropNudgeCta, .confirmPintCta:hover` gave the first-drop nudge its
hover border and shadow at rest, and the `:focus-visible` pair gave it a
permanent focus outline. Both selectors now qualify each class.

Button style is the first-drop nudge's own (`.firstDropNudgeCta`): coral
gradient, `--radius-sm`, 44 px, 0.82rem/700 Inter, dark label ink, one shadow
with offset and blur. Both are the same ask at the same pub, one kept action,
so they wear one treatment. The mechanical detector
(`impeccable detect`) reports nothing on the lines this PR touched.

## The aged-out row, after the rebase onto #1495

`after-aged-chip-<size>.png`, `after-aged-chip-detail-<size>.png`,
`after-aged-composer-<size>.png`. The same pub with its one row 90 days old,
which `lib/pintTrust.ts` reads as `aged-out` and the chip prints as "Over 30
days old, needs a fresh drinker". The door is built off that trust state
(`SECOND_DRINKER_STATES` in `lib/pintDropSecondDrinker.ts`), never off a lane
branch, so the aged row offers it too, with the same geometry as the
logged-once row: door at x 645 y 865 (768) and x 1319 y 586 (1440) beside the
line, wrapped left at 390. The `after-*` logged-once shots were retaken on the
rebased head and match the pre-rebase geometry to the pixel.

## The composer after the tap

`after-composer-<size>.png`. Journey: the door on the Overview, signed out.

| size | price step top | price step bottom | viewport |
| --- | --- | --- | --- |
| 390x844 | 188 | 425 | 844 |
| 768x1024 | 342 | 529 | 1024 |
| 1440x900 | 448 | 685 | 900 |

The price field holds `4.50`, the £4.50 quick-add is lit, and the sign-in link
stands where Log it would be, carrying `sel`, `log=1` and `price=4.50` back so
the account's first kept action lands on this composer. At 390 the whole price
step sits in the top half of the viewport, the same reveal `?log=1` earns
(`lib/logIntentReveal.ts`).

Pins: `__tests__/lonePintDropLane.test.ts`, `e2e/second-drinker-confirm.spec.ts`.
