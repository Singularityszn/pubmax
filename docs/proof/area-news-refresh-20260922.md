# Area-news refresh evidence, 22 September 2026

The area-news snapshot was generated at `2026-09-22T18:20:27.228Z` from a Keenable response collected and reviewed that day. The existing `refreshAreaNews` writer added one current announcement, retained 95 archive entries, and removed two expired generated entries. No freshness budget changed.

## Source and date

[Orbit Beers' announcement](https://orbitbeers.com/blogs/news/our-new-esb-for-cask-ale-week) names The Green Goddess as a collaborating pub for its ESB release. The page dates the announcement to 3 September 2026. Keenable returned `published_at: 1788458258`, which is `2026-09-03T17:57:38Z`.

The stored fact dates the announcement and says that the pub would receive the beer. It does not assert current stock or infer a year for the separate availability date. The parser matched the named pub to the Greenwich area and accepted the announcement within its existing 21-day window.

The canonical URL passed `isHarvestableOperatorUrl`. The live [robots rules](https://orbitbeers.com/robots.txt) permitted the article path before collection. The provider response retained the canonical HTTPS URL, publisher title, author, publication timestamp, and extracted JSON.

## Collection and generation

The initial broad refresh fetched 36 permitted sources and accepted none. Its output file stayed unchanged. A later targeted search returned the Orbit article with a tracking query. The reviewed canonical URL was used for collection.

The default extraction returned no usable fact. A focused prompt requested only the publisher's dated announcement about The Green Goddess, excluding other pubs and any current-stock claim. The resulting provider response was reviewed against the source page, then replayed through the existing writer. A second extraction with different wording had failed validation, so it was not substituted for the reviewed response.

The writer ran with its real current clock and unchanged parsing, date, and venue checks. Its result was:

```text
READY area news: 1 fresh facts from 1 candidates, 0 fetch failures, 96 total archive rows
```

## Validation

- `npm run check:freshness` exited 0. Three credential-backed feeds remained unmeasurable in that local process, as reported by the command.
- A separate production store check passed for weather, What's On, and night-signal candidates.
- The area-news and freshness unit run passed 216 tests across 16 files.

This document records a data refresh. It does not claim that the separate area-news transport changes, the combined release, or production deployment passed verification.
