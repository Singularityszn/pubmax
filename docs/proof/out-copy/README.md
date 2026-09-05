# /out listing copy hierarchy

Proof for the /out softening asked for in the Fable 5.1 brief of 5 September
2026, section 4: "`Listings from Ticketmaster.` + unmatched places" reading as
the product's night story.

## What the shots show

`GET /api/out` is mocked so the two supply states are deterministic. Both
payloads answer `venueMatch: "ready"` with four Ticketmaster rows at unlisted
places; the `one-matched` payload adds a fifth row that resolves to a listed
pub.

| File | State |
| --- | --- |
| `*-unmatched-only-390.png`, `*-unmatched-only-1440.png` | Every row is at a place we do not list. No card renders. |
| `*-one-matched-390.png`, `*-one-matched-1440.png` | One row is at a listed pub, four are not. |

## Before

`before-unmatched-only-*`: the count, the provider credit and the way onward
were the whole page, at the same weight as the page's own status copy, under an
empty listing surface. "Also, 4 listings tonight are at places we don't list
yet." subordinated the sentence to nothing.

`before-one-matched-*`: the aside sat below the card, but at status size with a
bold underlined link, so it read as a second section rather than as a note.

## After

`after-unmatched-only-*`: the night's own answer leads in the `EmptyState`
idiom, and the provider credit is the last and quietest line.

`after-one-matched-*`: the aside is ruled off from the cards and set below the
page's own copy. The count, the places, the credit and the way onward are all
unchanged in substance.

## How they were taken

A production build (`NEXT_DIST_DIR=.next-prod`) served on port 3177, driven by
Playwright at 390x844 and 1440x900 with `deviceScaleFactor: 2`, analytics
consent denied and the tour and onboarding markers set. The script lives in the
session scratchpad; the payloads it sends are the ones pinned in
`e2e/out-tab.spec.ts` under "out supply honesty".
