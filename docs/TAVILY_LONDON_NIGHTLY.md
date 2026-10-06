# Tavily London nightly

The workflow `.github/workflows/tavily-london-nightly.yml` runs one capped London pass every night at 02:30 UTC. It reads official pub sites with Tavily. It writes first-party listed prices and opens one review PR. It never pushes to a protected branch and never merges.

## Cost

The code holds two ceilings. No flag can raise them.

| Ceiling | Value | Where |
| --- | --- | --- |
| Searches per run | 200 | `MAX_TAVILY_CALLS_PER_RUN` in `scripts/lib/tavilyPubEnrichment.mjs` |
| Credits per run | 400 | `MAX_TAVILY_CREDITS_PER_RUN` in the same file |

An advanced search costs 2 credits. The pay as you go price is $0.008 a credit. A full night costs 200 x 2 x $0.008 = **$3.20**. A 30 night month costs at most **$96**. The run asks before each search and reserves the dearest search billed so far, never less than 2 credits. It stops when one more search like that would pass 400 credits, so a provider that bills 6 or 7 credits a search still cannot carry the run over the ceiling. `--max-queries` and `--max-credits` can only lower the ceilings.

London holds 3,640 pubs in the UK OSM pack. 1,861 of them state a website. A pub with no website uses no query. One full walk takes about 10 nights.

## Order

Each night reads the pubs with the stalest evidence first. A pub that was never read comes first, in the pack's own order. When every pub has been read, the walk does not stop. The pubs read longest ago come round again. A failed search is not a read, so that pub goes first the next night.

A night that runs no search while a pub still waits for one fails the job. A green job therefore always means that searches ran.

## State

The checkpoint is the gitignored file `.tavily/enrichment/london.json`. It holds the last read time of each pub and every price found so far. The workflow restores it from the Actions cache before the run and saves it after the run.

A changed UK OSM pack or `--reset` restarts the walk. It does not fail the job. The prices found so far carry over, so a night that was paid for and not merged yet is not lost. A price for a pub that left the pack is dropped, and the run log counts it. A lost cache starts an empty checkpoint.

## The committed data is the source of truth

Each night writes the London official-site prices in `public/data/drink_price_updates/latest.json` again. Each nightly PR carries its own run report, `data/enrichment/tavily/london/run_<stamp>.json`, with the night's read time. A run report on the default branch therefore means that night's PR merged. Do not remove a run report from a PR that you merge.

Each night applies these rules:

1. Every committed row stays as it is, unless a newer reading of the same drink replaces it in the PR for review.
2. A checkpoint row read no later than the newest merged night, and absent from the committed data, is dropped. That PR carried the row, so a reviewer removed it. This is true when the row was removed from the PR before the merge, and when it was deleted after the merge.
3. A row whose pub and source URL are in `data/enrichment/tavily/london/rejected.json` is never written.
4. A price whose pub, drink and category are in `data/enrichment/tavily/london/corrected.json` is never overwritten. A new reading of that drink is dropped, even after the walk restarts and reads the page again. A nightly reading only adds new rows and updates uncorrected ones.
5. Every other checkpoint row is unmerged evidence, and the PR carries it.

Each review PR therefore holds every unmerged night, even when an earlier PR was not merged yet.

## Reject rows

To reject a whole nightly PR, close it. Then do these steps:

1. Make a branch from the default branch.
2. Run `npm run tavily:reject -- --city=london --ref=origin/tavily-london/<stamp>`.
3. Commit `data/enrichment/tavily/london/rejected.json` and merge it.

The command lists each pub page whose rows the closed PR added and the committed data does not hold. A closed PR also carries the unmerged rows of the nights before it, so close a PR only when you reject all of its new rows. To drop the rows of one pub page only, remove them from the PR before you merge it. To also stop later nights writing that page again, add its `venueKey` and `sourceUrl` to `rejected.json` in the same PR.

## Correct a price

To correct a price, do these steps on the nightly PR branch or on a branch from the default branch:

1. Edit the price in `public/data/drink_price_updates/latest.json`.
2. Before you commit, run `npm run tavily:correct -- --city=london`.
3. Commit `latest.json` and `data/enrichment/tavily/london/corrected.json` together, and merge them.

The command compares `latest.json` with the committed copy at `HEAD`. Use `--ref=<ref>` to compare with another commit. It lists each London official-site price whose `priceGbp` changed, keyed by `venueKey`, `drinkName` and `category`. Delete an entry from `corrected.json` to let nightly readings update that price again.

## Wine and cocktail estimates

The wine and cocktail estimate rows in `public/data/price_estimates/baselines.json` are empty today, because every wine and cocktail price read so far comes from one operator. A London borough gets a row once the price data holds wine or cocktail prices from 3 or more operators in that borough. This nightly pass records pint prices only today, so it does not fill those rows yet.

## Evidence

Every price row keeps the pub's own page URL, the licence text for a first-party publisher and the read time. The run report in `data/enrichment/tavily/london/` lists each matched page. Tavily is never the source of a price. `validate-data` runs before any PR opens.

## Run it by hand

```sh
TAVILY_API_KEY=... npm run enrich:city -- --city=london --max-queries=20 --dry-run
```

A dry run still spends the searches. It only skips the writes.

## Related

[`docs/TAVILY_NIGHTLY_PASS.md`](./TAVILY_NIGHTLY_PASS.md) describes the separate credit allowance pass that writes only a curation queue.

## Source policy and failures

A pub website that `isHarvestableOperatorUrl` refuses is never sent to Tavily as a search domain. The pub gets the outcome `refused-source` and no query is spent. A result URL the policy refuses is dropped. One pub's failed search (a timeout or a 429) is recorded as `failed`, the pub stays the stalest, and the night carries on with the next pub.

The review PR script gives each run its own branch, `tavily-london/YYYYMMDD-HHMMSS`, so a manual rerun on the same UTC day never collides with the scheduled run.
