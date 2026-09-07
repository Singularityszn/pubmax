# The Tonight lede, 7 September 2026

What a reader meets first on `/tonight`, before and after the lede rebuild.

## The finding

Grok read the 08:37 deploy. The hydrated page led with "Deals tonight, Small
Plates Club, J D Wetherspoon", the quiet chip printed "No date on this yet via
what's-on", and `/api/whats-on` was at that moment serving 96 J D Wetherspoon
deal rows and 24 Ticketmaster event rows, each of them dated. Every existing
Tonight fence was green, because every one of them renders to static markup and
the defect only exists once the page hydrates.

## Method

A production build of this branch, `NEXT_DIST_DIR=.next-prod`, served on
127.0.0.1:3948 and driven by Playwright at 390x844 and 1440x900, in light and
dark, at deviceScaleFactor 2, full page.

Two arms:

| Shots | Supply |
| --- | --- |
| `tonight-lede-*` | The real committed pack (48 rows) and this machine's own keyless reads. |
| `chains-*` | The same build with `/api/whats-on` stubbed at the shape production serves: 96 Wetherspoon deal rows across four offers, 24 Ticketmaster events, 6 Greene King fixtures. |

The stub is the only way to see the chain blocks locally: the bundled deals file
was generated on 10 August and every row in it has closed, so a keyless machine
reads an honestly empty night.

## What the shots show

1. **The lede is pubs.** "Pubs people are talking about" leads, five rows deep,
   each with the publisher, the day that page was read, and a link to it.
   Simmons carries "Not on our map yet" and no pub link, because our curated
   index has no pin for it.
2. **No chain and no ticket platform is in the lede region.** The Wetherspoon
   supply is under it, under the chain's own name, with "Checked 7 Sept" beside
   it and one row per offer saying how many pubs run it.
3. **The quiet chip is dated.** "Quiet night · Checked 7 Sept · via what's-on",
   off the live read's own per-kind map rather than a snapshot on disk.
4. **A quiet night answers with pubs.** "Cheapest listed pints" carries four
   real pubs at £1.99 with the collection day under them, above the vibe chips.

## What these shots do not prove

The `chains-*` arm is a stubbed read, so the row counts are the fixture's rather
than tonight's. The lede arm is the real pack. Neither arm is production.
