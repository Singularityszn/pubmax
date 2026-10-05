# Tavily London nightly

The workflow `.github/workflows/tavily-london-nightly.yml` runs one capped London pass every night at 02:30 UTC. It reads official pub sites with Tavily. It writes first-party listed prices and opens one review PR. It never pushes to a protected branch and never merges.

## Cost

The code holds two ceilings. No flag can raise them.

| Ceiling | Value | Where |
| --- | --- | --- |
| Searches per run | 200 | `MAX_TAVILY_CALLS_PER_RUN` in `scripts/lib/tavilyPubEnrichment.mjs` |
| Credits per run | 400 | `MAX_TAVILY_CREDITS_PER_RUN` in the same file |

An advanced search costs 2 credits. The pay as you go price is $0.008 a credit. A full night costs 200 x 2 x $0.008 = **$3.20**. A 30 night month costs at most **$96**. The run asks before each search and stops when the next search would pass 400 credits. `--max-queries` and `--max-credits` can only lower the ceilings.

London holds 3,640 pubs in the UK OSM pack. 1,861 of them state a website. A pub with no website uses no query. One full walk takes about 10 nights.

## Order

Each night reads the pubs with the stalest evidence first. A pub that was never read comes first, in the pack's own order. When every pub has been read, the walk does not stop. The pubs read longest ago come round again. A failed search is not a read, so that pub goes first the next night.

A night that runs no search while a pub still waits for one fails the job. A green job therefore always means that searches ran.

## State

The checkpoint is the gitignored file `.tavily/enrichment/london.json`. It holds the last read time of each pub and every price found so far. The workflow restores it from the Actions cache before the run and saves it after the run.

A lost cache, `--reset` or a changed UK OSM pack starts a fresh checkpoint. It does not fail the job. A fresh checkpoint starts from the London official-site prices already in `public/data/drink_price_updates/latest.json`, so a restart never deletes a reviewed price.

Each review PR is therefore complete even when an earlier PR was not merged yet. When a pub's page is read again, its new rows replace its old rows.

## Evidence

Every price row keeps the pub's own page URL, the licence text for a first-party publisher and the read time. The run report in `data/enrichment/tavily/london/` lists each matched page. Tavily is never the source of a price. `validate-data` runs before any PR opens.

## Run it by hand

```sh
TAVILY_API_KEY=... npm run enrich:city -- --city=london --max-queries=20 --dry-run
```

A dry run still spends the searches. It only skips the writes.

## Related

[`docs/TAVILY_NIGHTLY_PASS.md`](./TAVILY_NIGHTLY_PASS.md) describes the separate credit allowance pass that writes only a curation queue.
