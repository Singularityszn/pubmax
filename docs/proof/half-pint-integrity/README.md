# Half-pint integrity: the measure field, before and after

Contribution battle test D04. Six shots of the Pint Drop composer on the venue
sheet at Arnos Arms (`venue-xjf3n0`), the pub the report found the defect over,
at the three widths the captain's rule names.

| Width | Before | After |
|---|---|---|
| 390x844 | `before-composer-390.png` | `after-composer-390.png` |
| 768x1024 | `before-composer-768.png` | `after-composer-768.png` |
| 1440x900 | `before-composer-1440.png` | `after-composer-1440.png` |

## What changed on screen

BEFORE, the composer asked two questions: what it cost, then a free `Drink`
field whose own placeholder invited the answer that broke the lane, "Pint,
half, soda, guest ale". Nothing downstream read that text, so "Half of lager"
at £2.60 entered the pint lane, was confirmed by a second drinker as "£2.60 a
pint", and fed pin colour, the cheapest-pint buckets and the Pint Index at a
pub whose pint is £5.50.

AFTER, a closed `What measure?` row sits between the price and the drink, on
Pint by default. The drink placeholder is `Lager, stout, guest ale`, so it no
longer invites a measure. A priced drop that claims the pint measure while its
own words say half is refused with one line that hands the drinker the control:
"Pick the measure first, so a half never reads as a pint."

The measure chips share the price quick-adds' shape, because two chip rows in
one composer are one control system. The selected chip's label takes
`--brass-ink` rather than `--brass`: the accent as a WORD reads 2.9:1 on its own
tint in light, and the ink token points back at `--brass` in dark so one coral
survives the theme.

## How these were taken

Two `next dev` servers on isolated dist directories, one holding `origin/main`'s
`ComposerPriceStep.tsx` and `spillComposer.css` (before) and one holding this
branch's (after), driven over CDP against Chrome for Testing 151.

Each shot is verified in the same pass that captures it: the run asserts the
Pint Drop panel has unhidden, that the price step has a non-zero box on screen,
and that the measure chips read `[Pint,Half,Other]` for an after shot and `[]`
for a before one. Two traps are worth recording for the next reader.

1. THE TAB LABELLED "Drinks" IS NOT THE PINT DROP TAB. It opens
   `venuePanel-menu`, the drink menu. The composer lives in
   `venuePanel-pints`, whose tab is labelled Stories, so the run targets the
   tab by `aria-controls` rather than by its name.
2. A HIDDEN TABPANEL GIVES THE COMPOSER A ZERO BOX. Opening the composer in the
   same tick as the tab selection leaves `[data-testid=spill-price-step]` in the
   DOM with `height: 0`, and a screenshot then shows a composer that is
   genuinely not painted. The run waits for `#venuePanel-pints` to unhide and
   for the step to measure above zero before it captures.

The map canvas reads "Map unavailable" in these shots: the headless browser has
no WebGL. Every surface under test lives in the sheet and does not need it.
