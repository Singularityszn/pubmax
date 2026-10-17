# London pub food harvest

`npm run harvest:uk-food` reads what a London pub's own website states about
its food: dish, category and £ price. `npm run build:food-price-updates` then
publishes the reviewed rows into `public/data/food_price_updates/`, the pack the
venue Menu tab reads. The rule this lane keeps is in
[`docs/rules/scripts-harvest-and-source-permission.md`](rules/scripts-harvest-and-source-permission.md#a-pub-s-own-food-menu-is-read-like-its-drinks-list-and-only-its-price-fact-ships).

## What it reads

| Target | From | Row key |
| --- | --- | --- |
| Curated London venues | the menu URL each venue's operator page names in `public/data/venue_menu_enrichment.json` | the curated venue id |
| London OSM pubs with their own site | `data/osm/uk/uk_osm_pubs.json`, Greater London bbox, `website` tag | `venue-uk-*`, as the base layer keys them |

A host a curated venue already owns is left to the curated lane. Social,
listings and delivery hosts are never a target. Nothing else is read: no
aggregator, no delivery app, no review site, and no third-party link a pub's
page happens to carry.

## Before a run

1. The environment must reach the pubs' own hosts. A London run touches more
   than a thousand domains, so it needs full network access rather than an
   allow-list.
2. For pages that only show their menu in a browser, set `BROWSERBASE_API_KEY`.
   Without it the lane reads served pages only and its report says rendering
   was not configured.
3. Every host is still asked live: `lib/harvest/sourcePolicy.ts` first, then
   its own `robots.txt` for each path. A refusal is a finding in the ledger,
   not a gap to work around. A page that answers 401, 403, 407, 429 or 451, or
   serves a bot challenge, is recorded `refused-by-site` or
   `blocked-by-challenge` and is never sent to Browserbase, whatever `--render`
   says.

## Commands

```sh
# A first look: one host, nothing written.
npm run harvest:uk-food -- --source curated --hosts 1 --dry-run

# The whole of London. Resumes from the ledger; --reset starts again.
npm run harvest:uk-food -- --pages 8000 --renders 500

# Ask the hosts that failed or were unreachable once more.
npm run harvest:uk-food -- --recheck failed,robots-unreachable

# Publish what the run read, after a review of data-harvest/uk_food/rows.jsonl.
npm run build:food-price-updates -- --dry-run
npm run build:food-price-updates
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--source curated\|osm\|all` | `all` | which targets to read |
| `--pages N` | 8000 | page budget for the run, served and rendered together |
| `--renders N` | 500 | Browserbase sessions the run may open |
| `--render auto\|never\|always` | `auto` | `auto` renders only when the served page answered and states no menu; `always` renders every page that answered |
| `--hosts N` | all | read at most N hosts |
| `--only <text>` | none | read only hosts whose name contains the text |
| `--recheck <outcome,...>` | none | forget those ledger outcomes and ask again |
| `--reset` | off | ignore the ledger |
| `--dry-run` | off | print the report and write nothing |

## What it writes

| File | Committed | Holds |
| --- | --- | --- |
| `data-harvest/uk_food/hosts.json` | no | the ledger: one row per host with its outcome, robots answer and pages |
| `data-harvest/uk_food/rows.jsonl` | no | candidate rows, each with the menu's own words as evidence |
| `data/uk_food/harvest_report.json` | yes | the run's counts: outcomes, drops, renders, rows |
| `public/data/food_price_updates/prices_YYYYMMDD.json` and `latest.json` | yes | the published pack, written by the build step only |

## Reviewing a run

Before publishing, read `rows.jsonl` for a sample of pubs against their pages:
the `quote` field is what the page said and `source.url` is where. Drop a bad
row by removing it from `rows.jsonl` before the build step. The build step
publishes only the price fact, its page, its date and the first-party licence,
and it replaces every older row of a pub it re-read.

When the first reviewed pack lands, the same PR moves the
`food_price_updates` registry entry off `retired` and gives it a staleness
budget, because from then on the lane owes a refresh.
