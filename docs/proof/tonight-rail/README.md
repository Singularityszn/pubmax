# Tonight rail and one cheap pint per chain

Site audit 13 Sep 2026, lane 7 (D8, D17).

## How the shots were taken

- Two production builds with the Playwright `webServer` env: `aa6470eec` (before) and this branch (after).
- Dark scheme, device scale 2, consent denied, tour done.
- The same quiet night on both builds: `/api/whats-on` answers no rows and `/api/out` answers ready with no events. The keyless build cannot reach the live What's-On read.
- `measure-before.json` and `measure-after.json` hold the boxes read from the DOM at each width.

## What the boxes say

| | before | after |
| --- | --- | --- |
| 1440 rail (`aside.tonightContext`) | 360 x 0 | 360 x 1,224 at x=948, y=168 |
| 1440 lede top | y=326 | y=326 |
| 1440 page height | 4,165px | 3,085px |
| 1440 cheapest listed pints | x=132, under the lede | x=948, in the rail |
| Chain blocks inside `.tonightPrimary` | yes | no |
| Walk-times toggle radius / height | 0px / 44px | 14px / 44px |
| Horizontal overflow at 390, 768, 1440 | none | none |

Cheapest listed pints:

- Before: The Fox on the Hill, The George, The Kentish Drovers, The Moon Under Water. All four are Wetherspoon at £1.99, and none says so.
- After: The Fox on the Hill (Southwark · Wetherspoon, £1.99), The Millers Well (£2.39), The Coronet (£2.66), Nags Head, Peckham (£2.90).

## Known gap

The cap and the label work only for pubs a source ties to the chain, and for the Wetherspoon pubs on this list that source is the Wetherspoon directory. The Millers Well and The Coronet are Wetherspoon pubs that are missing from that directory today, and neither price listing names the operator, so they still show unlabelled and uncapped. The chain is never read from a pub's name (rule in `app/AGENTS.md`). The fix is a refresh of `public/data/wetherspoons/pubs.json` from the chain's own directory, filed as task `wetherspoons-directory-refresh` in another lane.
