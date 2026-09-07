# The three design-review follow-ups, measured

The 6 September 2026 web design review (`docs/proof/design-review-fix-web/REPORT.md`)
closed with three rows it recorded rather than took, which moved to
`docs/design/BACKLOG.md`. This is the measurement of taking them.

Both builds are production builds of this repository served on a local port,
walked by Chromium at the two widths the review itself walked: 390x844 and
1280x800. "Before" is the tree this branch was cut from; "after" is this
branch. Every figure below was read off `getBoundingClientRect()` and
`getComputedStyle()` in the browser, never from a stylesheet.

## 1. The profile editor's own button family

`/u/you` painted its own controls: the account grid's form buttons at 12px
corners, the Night Profile save at 12px and weight 750, the export and deletion
doors as 12px boxes with their own fills, and the Memory studio two more
families beside them. Every text button on the surface is
`components/ui/button.tsx` now, and `app/u/[handle]/profile.css` paints none of
them: the rules that survive place a control and never restate its radius,
weight or height.

| | Before | After |
|---|---|---|
| `Rename handle` | 12px corners, ink fill | 14px, quiet secondary |
| `Save private details` | 12px | 14px |
| `Create private Memory` | 12px, weight 750 | 14px, weight 700 |
| `Delete my account` | 12px, its own red fill | 14px, the primitive's `danger` |
| Families on the surface | five | one |

Shots: `before-profile-editor-390.png`, `after-profile-editor-390.png`, and the
1280 pair.

Two decisions ride with it. The editor's controls are the QUIET half of the
family, because one painted primary per screen is the house rule and `/u/you`'s
is the identity card's own door: a settings card's action is a control of the
same family rather than a second coral fill. And the one control that ENDS
something keeps its red as a variant of the primitive (`uiButton--danger`)
rather than a geometry of its own.

The new fence in `__tests__/buttonPrimitive.test.tsx` found one more on its way
in: the Moment alt-text `Save description` control, a 10px box at 0.75rem.

## 2. One family for number squares

The planner's pub-stop count wore 10px corners and the `/pubs` fare-zone picker
`--radius-sm` (6px) on 44px squares: two look-alike controls asking the same
question in two shapes. Both render `Chip variant="number"` now.

| | Before | After |
|---|---|---|
| Planner stop count | 10px corners | 14px, weight 700, 13.76px type |
| `/pubs` zone chips | 6px corners | 14px, weight 700, 13.76px type |
| Selected state | plan accent tint beside `--state-active-*` | one `--control-tint-*` |

The chip primitive moved off the Tailwind classes an unlayered
`button { font: inherit }` was silently beating - which is why the zone chips
rendered at the inherited size and weight rather than the 14px/700 their class
asked for - and onto `components/ui/chip.css`, the same `--control-*` row the
text button reads. The map's own zone picker keeps its segmented treatment:
that is one control divided into segments by a recorded design judgement, not a
row of squares.

Shots: `before-plan-stop-count-*.png`, `after-plan-stop-count-*.png`,
`before-pubs-zone-chips-*.png`, `after-pubs-zone-chips-*.png`.

## 3. A deliberate ladder for the quick price chips

The five common prices wrapped, and what was wrong was that the wrap fell out of
`flex-wrap` and the chips' own text widths, so the rows re-cut themselves per
width and a wider label would move the cut again. Measured on the same build:

| | Before | After |
|---|---|---|
| 390x844 | 4 + 1, chip widths 59 to 60px, the second row starting at the first column by luck | 4 + 1, every column 63px, the fifth chip's left edge equal to the first's |
| 1280x800 | 3 + 2 | 4 + 1 |
| Column widths in a row | several values across the two widths | one value |

`lib/priceChipLadder.ts` owns the count and `components/map/spillComposer.css`
reads it. It is FOUR at every width rather than four on a phone and five above
it, and the reason is a measurement: the composer's chip row is 269px inside the
phone sheet and 238px inside the desktop drawer, so the desktop row is the
narrow one, and five 44px targets plus their gaps need 244px. A five-column rung
was tried first and measured the desktop chips at 43px wide, under the tap
target the row promises; the rung was dropped rather than the target.

The chip that carries a word beside its figure (a pub's own last logged price,
tagged `last`) takes two columns rather than clipping inside one.

Shots: `before-price-chips-390.png`, `after-price-chips-390.png`, and the 1280
pair.

## What holds it

- `__tests__/buttonPrimitive.test.tsx` - the editor paints no button of its own,
  and every editor control is the primitive in its quiet variant.
- `__tests__/chipPrimitive.test.tsx` - the chip primitive is unlayered, reads the
  control row, and both number-square surfaces render one component.
- `__tests__/priceChipLadder.test.ts` - the ladder's numbers, the rows they cut,
  and the stylesheet held to them.
- `e2e/design-review-followups.spec.ts` - all three, measured in a browser at
  390x844 and 1280x800, and the source of every shot in this directory.

Copy is unchanged, no dependency was added, and no route budget moved.
