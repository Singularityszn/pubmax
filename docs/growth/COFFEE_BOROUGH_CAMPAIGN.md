# Coffee borough campaign (ops playbook)

Wave 2 stretch. One borough at a time for coffee (and later alcohol-free /
soft-drink) map density. Same trust rules as every community price: a figure
reaches the map only when a second independent drinker corroborates it inside
the age window. See `lib/communityPrice.ts` and
`docs/plans/FIRST_PRINCIPLES_OUTINGS.md` (borough campaigns).

This note is for ops and growth. It is not product copy on a drinker-facing
screen.

---

## Hard rule: never seed prices

Do not invent coffee rows. Do not copy a menu into the community store to make
a borough look covered. Do not hand-edit fixtures that ship as live prices.

A seeded figure would paint pins that nobody saw. That breaks the promise the
map makes. Coverage grows only when drinkers log what they paid and a second
account agrees.

If the web has no price for a pub, say so in an ops note. Leave the pin empty.

---

## Seed borough: Camden

Start here. Camden already has footfall, tourist and local mix, and enough
daytime coffee traffic that a real corroboration loop is plausible without
faking density.

What "done enough to widen" looks like for Camden:

- Several pubs with a corroborated, in-window coffee price (count them with the
  report below; do not guess).
- Submit UX still opens honest about coffee as a logged category, not a
  city-wide claim.
- No marketing line that says coffee prices are city-wide until more boroughs
  clear the same bar.

Next boroughs stay undecided until Camden's week-on-week count moves for real.
Clapham (as a night-area label when a fixture lacks borough) is a reasonable
follow-on, not a parallel seed.

---

## How coverage is earned

1. A signed-in account with a claimed handle submits a coffee price at a pub
   (`POST /api/price-submit`, category `coffee`).
2. A second independent submitter logs a figure that agrees within the
   tolerance window.
3. While both stay inside the 30-day max age, that pub can paint under the
   coffee lens. One lone report may mark the pin as provisional; it does not
   colour the map.

Alcohol-free and soft-drink use the same corroboration and age gates. They are
optional columns on the ops report, not a second campaign until coffee has a
measurable Camden baseline.

---

## Measuring density (local, keyless)

```bash
npm run report:coffee-borough -- --fixture path/to/fixture.json
npm run report:coffee-borough -- --fixture path/to/fixture.json --categories coffee,alcohol-free,soft-drink
```

The script is `scripts/report_coffee_borough_coverage.mjs`. It reads fixture
JSON only: no network, no writes. Each area cell is the count of venues with
at least one corroborated, in-window price for that category. Borough first;
night-area label only when borough is missing on the venue row.

Unit pin: `__tests__/coffeeBoroughCoverage.test.ts` (tiny fixture, no network).

---

## What this campaign does not touch

- Pint-first submit defaults and first-price UI stay as they are.
- Do not merge UK base pubs into the curated index to invent coffee coverage.
- Do not widen `MAP_LENS_DRINK_CATEGORIES` marketing until the numbers from the
  report justify a wider claim.
