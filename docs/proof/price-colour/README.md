# The price colour law, before and after

Captain's law (5 September 2026): RED means expensive, YELLOW means affordable
and average, GREEN means cheap, and a price wears no other colour. Trust is a
word, a badge or a pin shape. The rule and the London numbers are in
`docs/PRICE_BANDS.md`; the module is `lib/priceBand.ts`.

Three surfaces at three sizes. "Before" is production (pubmaxxing.com) on the
morning of 5 September 2026, "after" is a production build of this branch on
the private e2e port, both shot by Playwright's Chromium at device scale 2
with first-run chrome dismissed and analytics consent answered.

| Surface | 390x844 | 768x1024 | 1440x900 |
| --- | --- | --- | --- |
| `/` landing answer card | `landing-390-before.png`, `landing-390-after.png` | `landing-768-*` | `landing-1440-*` |
| `/map?sel=venue-1vle947` venue sheet | `map-sel-venue-1vle947-390-*` | `map-sel-venue-1vle947-768-*` | `map-sel-venue-1vle947-1440-*` |
| `/near?patch=soho` near-you rail | `near-soho-390-*` | `near-soho-768-*` | `near-soho-1440-*` |

## What changed on each

**Landing.** Before: The Blackfriar's £6.50 Pravha sat on the brass plaque and
the "Listed" chip wore amber, so the dearest pint on the page read yellow.
After: the £6.50 plaque is red (London's expensive band starts past £6.15),
the "Listed" chip is a neutral badge carrying the word alone, and the rail
under it paints The Crosse Keys £2.99 green.

**Venue sheet.** Before: the modelled est. £6.50 wore the blue "modelled"
tone. After: est. £6.50 is red with the word "Estimated" and the method link
beside it; a £4.50 pint logged there (the trust-read fixture) is green on the
sheet and on the phone peek, with its "Logged once" line unchanged. The pins
behind the sheet moved with the same thresholds: £4.80 green, £5.90 and £6
yellow, £6.50 and above red.

**Near-you rail.** Before: every figure was green text, whatever it cost.
After: each figure is a plaque wearing its own band. Soho's five cheapest
listed pints within a walk are £5.20 to £5.95, all in London's middle third,
so the rail is honestly yellow throughout.

## Held by

`e2e/price-colour-law.spec.ts` (paint asserted against a probe element at
390x844), `__tests__/priceBand.test.ts` (rule, table, token contrast),
`__tests__/priceBandSurfaces.test.ts` (every surface, and no colour from a
standing).
