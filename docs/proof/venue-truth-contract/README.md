# The venue truth contract (Astra F03), and the freshness lane's health claim (F12)

Measured on a keyless production build of this branch, before and after, at
320x568, 390x844, 768x1024 and 1440x900 in light and dark. The pub in every
`venue-sheet-*` shot is `venue-p7p18j`, The Three Tuns at the LSE student
centre, which is the pub Astra measured on production.

## What production answered, 6 September 2026

`GET https://pubmaxxing.com/api/venue/venue-p7p18j`:

| Field | Production answered | What the source holds |
| --- | --- | --- |
| `prices[0].phone_number` | `"\u{1F310} https://www.lsesu.com/social/three-tuns/"` | a website URL with a globe emoji, in the phone column |
| `venue.amenities.*` | every key `false` | every column blank |
| `busyness.isOpen` | `"unknown"` | no opening hours |
| `busyness.reportCount` | `0` | nobody reported the room |
| `getIn.fit` | `"likely"`, "Two of you should get in fine, but no promises on a Sunday" | neither half of the evidence a positive answer needs |

There was no sanitized contact contract and no `amenityStatus`.

## What this branch answers

Same request against the branch build:

```
getIn: unknown / Check before going / confidence unknown
contacts: {"phoneNumber": null, "phoneHref": null,
           "websiteHref": "https://www.lsesu.com/social/three-tuns/",
           "emailHref": null, "bookingHref": null}
amenityStatus food/beerGarden: unknown unknown
raw contact columns on price rows: []
```

## The amenity row

`venue-sheet-*` before: nine chips over a pub whose every amenity column is
blank. Six of the nine were greyed, which reads as a stated No. The bundled
dataset states no absences at all: measured over its 3,760 rows, the ten
amenity columns carry only yes-shaped values and blanks.

`venue-sheet-*` after: no row at all, because nothing is stated.

`venue-sheet-stated-*` after: the same sheet for `venue-3kkk8e`, Camden Head,
whose source does state amenities. Three chips, in the accessibility row's
brass idiom rather than the old green, because only stated facts render now and
a green chip would encode nothing while colliding with the cheap price band.
"Serves food" prints once, as the sentence, rather than as a chip and a
sentence on one sheet.

## The locality qualifier

An area is a centre and a radius. The radius is the furthest a pub can be and
still be LISTED there; it is not a claim that the pub is in that place. The
Three Tuns sits 1.217 km from the Piccadilly & Soho centre, 0.87 of that area's
1.4 km radius, and /today printed it as being in Soho.

`AREA_CORE_RADIUS_FRACTION` is 0.75, measured over the 1,995 shipped slim rows:

| Core fraction | Pubs reading "in" | Core rows whose address names the area | Outer-band rows naming it |
| --- | --- | --- | --- |
| 0.60 | 490 (61.9%) | 42.4% | 22.3% |
| 0.70 | 577 (72.9%) | 39.2% | 22.9% |
| **0.75** | **624 (78.9%)** | **37.8%** | **23.4%** |
| 0.80 | 665 (84.1%) | 37.3% | 21.4% |
| 0.85 | 700 (88.5%) | 36.3% | 23.1% |

791 of the 1,995 rows sit inside some London area's disc. A pub in the core
names its own area in its own address about 1.6 times as often as a pub in the
outer band, which is independent evidence that the band is doing real work.
At 0.75 the band costs 167 rows (21%) a downgrade from "in" to "near".

`today-*` after: rows that only sit near the area the heading names carry a
quiet "Just outside" after the pub name. The words say the relation to the
PLACE, not to the reader, because the card's other copy says "near you".

The heading follows the rows. The /today list is ranked cheapest-first rather
than by distance, so it over-samples the rim: four of its five rows earn the
qualifier here, and a heading saying "in" over four rows saying "outside"
argues with itself. `todayPintsHeading` gives the card "The cheap ones around
<area>." when more than half the rows are outer-band and keeps "in" otherwise,
a tie keeping the stronger word because half the rows really are in the place.

Nothing about which area LISTS a pub moved. `nightAreaForPoint` still answers
`piccadilly-soho` for the Three Tuns; only the strength of the claim changed.

## F12, the freshness lane

`price_updates` prose said its envelope date named 2026-07-03 while the shipped
envelope carried 2026-09-04. The rule was right and the date had rotted, so the
prose now states the rule and names no day of its own; nothing is restamped,
and there are no rows to restamp.

Seven `live` lanes answered `status: "live"` unconditionally, with no artifact,
no stamp and no probe: a health claim about upstream APIs this spine has never
spoken to. A live lane that resolves no observation is now `unmeasured`, which
is neither fresh nor stale and never a breach, so `npm run verify` is untouched
and the word stops promising something nobody measured.

## Reproducing

```
PUBMAX_E2E_KEYLESS=1 NEXT_PUBLIC_SW_VERSION=local NEXT_DIST_DIR=.next-prod-vtc \
  node scripts/run-with-restored-next-env.mjs sh -c 'npm run build'
PUBMAX_E2E_KEYLESS=1 NEXT_DIST_DIR=.next-prod-vtc npm run start -- -p 34118
node scripts/venue-truth-shots.mjs --base-url http://127.0.0.1:34118 --label after
```
