# London pub research, 7 September 2026

Issue: [#1618](https://github.com/Singularityszn/pubmax/issues/1618).

The research window is **8 August through 7 September 2026**, inclusive.
The file contains **34 venues and 97 source links across their rows**, covering 80 unique URLs.
One source can support several venues.

Each source records two dates:

- `publishedAt` records the post, comment, video, or article date.
- `observedAt` records the research capture date, 7 September 2026.

Only publication dates determine eligibility for this research window.
Reading an old article today does not make its mention recent.
The ingest retains `observedAt` for the public credit and leaves research metadata in this file.

## Evidence and corrections

This pass reuses the dated source captures from the original 7 September research run.
That run searched all of 2026. Its final selection often preferred an older, higher-engagement source.
This pass filters the retained captures to the stated month before selecting or ranking rows.
It also adds an independently opened Auld Shillelagh recommendation and a dated Time Out source for Wenlock Arms.

The retained original evidence is in the fleet research directory:
`data/hyped-pubs-research/scripts/evidence.txt` and `scripts/score.txt`.
The original report is `data/hyped-pubs-research/report.md` in the fleet workspace.
Those files describe the source acquisition and its limits; they are not the current month’s ranking.
The previous shipped selection remains available in Git at `6a759e0ac`.

All published rows have at least one dated source inside the month.
Why lines describe those recent sources, rather than borrowing an older video’s claims or viewing figures.
They contain no unverified drink prices, current opening hours, or measured popularity claims.

The selection excludes several misleading matches:

- The recent Albion source names Farringdon, not the held Islington venue.
- Recent Nag’s Head sources concern Walthamstow and Knightsbridge, not Peckham.
- The current Talli Queen video describes an unfinished venue and a delayed opening.
- The World’s End discussion concerns a service-charge complaint, rather than a recommendation.
- A Vinegar Yard tag alone does not establish the specific recommendation in the earlier why line.
- A Mother Kelly’s comment asks about future group meetings after an earlier event.

Multi-venue entries are narrowed to the named venue where evidence permits it.
Coach & Horses uses Soho, Blues Kitchen uses Brixton, and Bricklayers Arms uses Putney.
The ingest requires both name and area to match a curated name and borough before assigning an absent ID.
Neighbourhood aliases need an explicit verified ID.
Ye Olde Mitre in Holborn uses `venue-lkjwk4`, the curated entry at 51.51844, -0.107454, labelled Camden.
Hope and Anchor and Blues Kitchen stay unmatched because their Brixton locations differ from the held Hammersmith and Camden venues.
The pack retains 24 verified map matches.

Deleted comment `p61pmvm` supplies no readable evidence and is excluded.
Hope and Anchor therefore has five sources and a score of 42.
Effra Social describes an invitation, not a confirmed meeting; Roebuck no longer attributes walks to its sources.

The page shows one credit per row and selects the first source when capture dates tie.
Put a source supporting the whole why line first, regardless of publication order.
Devonshire credits the `amiet` caption about atmosphere and Guinness.
Princess Louise credits its interior description; the why line omits history found only in another source.
Source order does not change the newest publication date used for scoring.

## Sources reached

| Source | Evidence used in this pass | Access limit |
| --- | --- | --- |
| Reddit | Retained dated posts and comments; selected recommendation threads also opened independently. | Direct JSON access failed during the original run; its successful captures used ScrapeCreators. |
| TikTok | Retained dated captions from the successful 7 September capture. | Videos were not independently replayed in this pass. |
| Instagram | Retained dated captions from the successful 7 September capture. | Reels were not independently replayed in this pass. |
| YouTube | Retained dated video descriptions from the original `yt-dlp` capture. | Videos were not independently replayed in this pass. |
| Web | Time Out’s dated 10 August CAMRA report was opened independently. | An undated access timestamp is not publication evidence. |

The original run could not read Londonist, The Guardian, or Evening Standard in full.
None supplies a newly qualified row through an access date alone.
This is a review of captured public discussion, not an independent visit to each venue.

Useful checks include the [12 August London recommendations](https://www.reddit.com/r/LondonFood/comments/1vmf6ho/pubs_in_london_recommendations/),
the [11 August Irish-pub discussion](https://www.reddit.com/r/AskIreland/comments/1vlmkv4/pubs_in_london_that_feel_like_home_have_good/),
and [Time Out’s 10 August CAMRA report](https://www.timeout.com/london/news/camra-best-pub-2026-cockpit-chislehurst-081026).

## Ranking

Ranking uses only the selected, dated source records.
`mentions` counts distinct source URLs for that venue, not people or independent recommendations.
Repeated captures of one URL count once.
Replies in a venue-specific meeting thread indicate discussion, not a review score.

The editorial score adds three bounded terms:

1. Five points per source URL, capped at 60.
2. Ten points per source platform, capped at 30.
3. Ten recency points, reduced by one for each three days since the newest mention.

The recency term cannot fall below zero.
Reddit posts and comments count as one platform.
Ties use mention count, then venue name.
These weights express editorial order; they do not measure venue quality or citywide popularity.
The product does not print these scores or counts.

## Validation

Run `npm run ingest:hyped-pubs`, then `npm run ingest:hyped-pubs -- --check`.
The generated public file must retain all 34 research rows without source or copy refusals.
Every `publishedAt` must remain within the fixed research window.
Keep research publication dates separate from the public pack’s generation date.
