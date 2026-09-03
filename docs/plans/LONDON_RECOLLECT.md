# London price re-collect: what a dated London price can lawfully come from

Scout for the "dated re-collect" and "Index publishes" track, run 3 September 2026
against commit `81c8c7d1b`.

The question was narrow. Under the Pint Index rules in `lib/pintIndex.ts`, which
sources can give a London venue a price that carries both a `source.url` and an
`observedAt`, what fraction of the bundled dataset does each cover, and what is
the lawful basis for each.

**Answer: the eligible sources cover between 1.3% and 4.9% of London pubs. The
brief's stop rule is 20%. Work stopped here.**

## The denominators

`public/data/pint_prices_app_dataset.json` holds **3,761 rows**. A row is one pub
crossed with one pint, so the rows are not venues. Grouped on `pub_name` plus
`address` the file holds **1,902 distinct pubs**. Both denominators are quoted
below because the brief names 3,761 and the coverage question is about venues.

The file is stamped once, at `2026-07-03T12:00:00Z` (`data/freshness_registry.json:11`).
That is 1,476 hours old today, against a 2,160 hour neglect ceiling. The dataset
is therefore **not stale yet**. It goes stale on **1 October 2026**.

## What the Index will accept

`lib/pintIndex.ts:34-38` admits exactly three source kinds. Everything below is
measured against them.

| Kind | Extra bar the validator applies |
| --- | --- |
| `confirmed_pint_drop` | `reviewState` must be `"confirmed"` and a `confirmationId` must be present (`lib/pintIndex.ts:132-135`) |
| `official_publisher` | `publisherType` is `pub` or `brewery`, and `officialDomain` must match the `sourceUrl` host (`lib/pintIndex.ts:139-147`) |
| `open_data` | a named dataset and a licence string (`lib/pintIndex.ts:148-152`) |

## Coverage, source by source

### A. Confirmed Pint Drops: 0 venues, 0%

**No code anywhere can produce one.** `PintDropReviewStatus` in `lib/pintDrops.ts:77`
is `"hidden" | "pending" | "reported"`. There is no `confirmed` state, no
`confirmationId` writer, and no moderator action that mints one. The strings
`confirmed_pint_drop` and `reviewState: "confirmed"` appear only in the validator
(`lib/pintIndex.ts`) and in its mirror in `scripts/validate-data.mjs:3211-3220`.

So the count is zero regardless of how many Pint Drops production holds. The kind
is a contract with no producer behind it.

### B. Official chain menus already collected: 69 venues, 3.6%

`public/data/drink_price_updates/latest.json` holds 3,474 rows, and every row
already carries a `source.url` and an `observedAt`. The rows resolve to only
**69 distinct `venueKey` values**.

| Publisher | Rows | Host |
| --- | --- | --- |
| Nicholson's official drinks menu | 1,914 | `www.nicholsonspubs.co.uk` |
| Greene King official menu | 1,538 | `www.greeneking.co.uk` |
| Six independent venues | 19 | own domains |
| PUBMAXXING demo menu fixture | 3 | `pubmaxx.vercel.app` |

Two problems sit on top of the small venue count.

**The dates are all wrong for a September window.** The rows observe on 2026-07-06,
07-11, 07-18, 07-26 and 08-21. None fall in September.

**Over half the rows sit on a source the harvest policy refuses.** The two
governance tables disagree with each other today:

- `data/price_sources.json` lists `mbplc-nicholsons-official` and
  `nicholsons-official` as `permissible: true`.
- `lib/harvest/sourcePolicy.ts:131-147` records Mitchells & Butlers as
  `allowed: false`, `reason: "robots-unreadable"`, and names Nicholson's first in
  the evidence: the estate answers `/robots.txt` with a challenge page, so no
  permission can be read at all.

The brief set the existing lane's policy as the boundary. On that boundary the
1,914 Nicholson's rows are not re-collectable, which leaves Greene King and six
independents.

### C. First-party independent pub sites: about 25 venues, 1.3%

This is the lane the brief points at, `scripts/harvest_outer_london_prices.mjs`.
It verbatim-validates every price against the scraped first-party page text and
stamps `source.url`, `licence` and `observedAt`. Its evidence rules are sound.

**Candidate pool.** 930 of the 1,902 distinct pubs carry a `website` (48.9%). The
script skips chains proven to publish no web prices, because their prices live in
Order and Pay apps or in image menus:

| Chain group excluded | Distinct pubs |
| --- | --- |
| Greene King and sister brands | 113 |
| Mitchells & Butlers brands | 50 |
| Wetherspoon | 48 |
| Stonegate and Craft Union | 34 |
| Great Local Pubs | 11 |
| Social or holding page | 5 |

That leaves **669 candidate pubs, 35.2% of distinct pubs**. Candidates are not
prices. The lane has to open each site and find a stated pint price.

**Measured yield.** Two sweeps have already completed and both logged their
results.

| Sweep | Independents swept | Requests | Priced |
| --- | --- | --- | --- |
| Outer London (`data/osm/outer_price_harvest_log.json`) | 105 | 155 | **4** |
| Inner London (`data/osm/inner_london_price_harvest_log.json`) | 29 evaluated, 1 swept | 2 | **0** |

The outer sweep is the honest rate: **4 priced out of 105 swept, 3.8%**. Of 273
logged venues, 250 read `no-price-published` and 19 read `blocked`. The four that
worked were Tattoo Bar, Boom Battle Bar, Small Beer and Langham Working Mens Club.

Applying 3.8% to the 669 remaining candidates gives **about 25 newly dated venues,
1.3% of distinct pubs**. That is the realistic figure for a full sweep.

### D. Open data: 0 venues, 0%

No UK or London pint-price open dataset exists in the repository, and neither
allowlist names one. The `sources` array in `data/price_sources.json` holds two
entries and both are placeholders: `example-brewery-official` and
`example-open-data`, each carrying a `PLACEHOLDER` note. So the scheduled pint
refresh in `scripts/refresh_prices.mjs` has no real URL it is permitted to fetch.

### Totals

| Reading | Venues | Share of 1,902 pubs | Share of 3,761 rows |
| --- | --- | --- | --- |
| Realistic: a full sweep at the measured 3.8% yield | ~25 | **1.3%** | 0.7% |
| Most generous: every already-collected venue kept, refused sources included, plus the sweep | 94 | **4.9%** | 2.5% |

**The stop rule is 20%. The most generous reading is four times below it.**

## Three blockers that stand apart from coverage

Each of these would stop the work even if coverage were sufficient.

**1. The lane cannot run. No API keys exist.** The header of
`scripts/harvest_outer_london_prices.mjs` requires `EXA_API_KEY` and
`TAVILY_API_KEY`. `scripts/firecrawl_greene_king_prices.mjs` also requires
`BROWSERBASE_API_KEY`. There is no `.env.local` in this worktree and all three are
absent. Without them the re-collect produces zero rows, and the registry's own
rule is explicit: "Never restamp old rows after a zero-row retrieval".

**2. A September edition cannot be published in September.**
`monthPublishFloorBlocker` (`lib/pintIndexArchive.ts:252-259`) refuses any month
whose window end has not passed. September 2026 closes on 30 September at
23:59:59.999. The captain's release is by month end. The earliest lawful date for
a September edition is **1 October 2026**.

**3. Nothing builds the live snapshot.** `public/data/pint_index_snapshot.json` is
hand-maintained and currently `status: "empty"` with zero observations.
`scripts/publish_pint_index_month.mjs` only freezes what the live snapshot already
holds; its own header says the rules "die rather than guess". No script anywhere
writes that file. So making the Index publish needs an observation builder written
from scratch, plus the missing confirmation lane from section A.

## One item of the brief is already shipped

Step 2 asked to "make `validate-data` refuse any `drink_price_updates` row without
both" a `source.url` and an `observedAt`. That fence already exists.
`scripts/validate-data.mjs:2526-2557` already refuses a row whose `source.url` is
not an absolute http(s) URL, whose `source.licence` is empty, or whose `observedAt`
is missing, unparseable or in the future. There is nothing to add.

## What would actually move the number

Ranked by venues gained per unit of effort, so the decision has options rather
than one door.

1. **Ask Mitchells & Butlers for permission, or for a feed.** This is the single
   largest lever. It would settle the governance conflict in section B, unlock the
   1,914 Nicholson's rows for lawful re-collection, and reach 50 more London pubs
   directly. `lib/harvest/sourcePolicy.ts:145-147` already names the revisit
   condition.
2. **Build the confirmed Pint Drop lane.** Section A is zero only because no code
   confirms a drop. Community reports already exist and already carry dates. A
   moderator confirmation state plus a `confirmationId` would turn a live, growing
   stream into the Index's own supply, which is the only lane that scales with the
   product rather than with scraping budget.
3. **Fund the keys and sweep the 669.** Roughly 900 to 1,000 provider requests at
   the observed request-to-venue ratio, for about 25 venues. Real, dated, lawful,
   and small.
4. **Move the Index target month to October.** October closes on 31 October and can
   be published on 1 November. September cannot be published before the release
   date under any data conditions.

## Sources of every number here

- Row and venue counts: `public/data/pint_prices_app_dataset.json`, grouped on
  `pub_name` plus `address`.
- Dataset stamp and ceiling: `data/freshness_registry.json:11`.
- Eligible source kinds and their bars: `lib/pintIndex.ts:28-40`, `:127-152`.
- Pint Drop review states: `lib/pintDrops.ts:75-77`.
- Collected drink rows: `public/data/drink_price_updates/latest.json`.
- Permission verdicts: `lib/harvest/sourcePolicy.ts`, `data/price_sources.json`.
- Measured sweep yield: `data/osm/outer_price_harvest_log.json`,
  `data/osm/inner_london_price_harvest_log.json`.
- Publication floor: `lib/pintIndexArchive.ts:252-259`.
- Existing row fence: `scripts/validate-data.mjs:2526-2557`.
