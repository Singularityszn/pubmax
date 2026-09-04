# The UK price harvest

How a real, dated, attributed drink price gets from a pub's own website into
`public/data/uk_prices/`. Two lanes read pages, one builder bundles what they
found beside everything else this tree holds.

```
npm run harvest:uk-prices            # document lane: read what a page SERVES
npm run harvest:uk-prices-rendered   # rendered lane: read what a page SHOWS
npm run build:uk-price-bundle        # bundle every lane into one dataset
npm run validate-data                # refuse a row nobody could check
```

## The boundary, before anything else

`lib/harvest/sourcePolicy.ts` decides what may be read, and nothing takes a host
from a caller. A pub's own site is first-party by definition and needs no table
row; a chain estate needs one, and a host the table refuses on permission is
refused wherever it turns up, including under one of its own pubs' brand
domains (`REFUSED_ESTATE_HOSTS`).

Permission is then asked AGAIN, live, per host, every run, through
`lib/harvest/robots.ts`. An unreadable `robots.txt` is a REFUSAL, not a
missing one: a challenge page or a 403 means no permission can be read, and a
page we cannot ask about is a page we do not take. A genuine 404 publishes no
restriction and is honoured.

Three findings live under that one word, and they are separated because only two
of them are about permission.

* **A rules file with no rules is still a rules file.** What decides is whether
  the body PARSES as `robots.txt`, not whether it holds a `User-agent` line. An
  empty file, one that names only its Sitemap, and one that is comments to the
  last line each publish no restriction, which is the permission a 404 gives.
* **An HTML page served where a rules file should be is unreadable,** and stays
  refused. It cannot be told apart from a challenge page.
* **A network failure is not a refusal,** it is `robots-unreachable`, asked once
  more before it is believed. Reporting a host nobody was home at as a refusal
  says a pub turned us away when it has no site left.

`npm run harvest:uk-prices -- --recheck <outcome>` asks one finding again after
a rule changes, rather than throwing seven thousand answers away with `--reset`.

Neither lane bypasses anything. The rendered lane runs its browser with stealth
off, TLS shaping off and no challenge wait, identifying as PUBMAXX. A page
behind a challenge is counted as `blocked-by-challenge` and left alone.

## Lane one: the document

`scripts/harvest/uk-prices/run.mjs`. Candidate hosts are the `website` tags the
committed UK OSM pub snapshot already carries, grouped by host and crawled
biggest first. Per host it reads the home page, whatever the host's own
`robots.txt` names as a sitemap, and the links on the home page that look like a
drinks list, to a per-host page ceiling. Resumable: `data-harvest/uk_prices/hosts.json`
records what each host answered, so a rerun continues.

## Lane two: the browser

`scripts/harvest/uk-prices/render.mjs`, using wigolo (AGPL, local). It exists
because the document lane finds nothing on a menu assembled in the browser. That
is not a corner case: the served HTML of a Greene King per-pub menu carries
150 KB and no figure, which is how "Greene King publishes no web price" came to
be written into the source table on 2026-09-03. The same permitted URL read with
a browser on 2026-09-04 states 102 prices, so that verdict was withdrawn.

The lane reads the per-pub menu page of every chain the source table allows,
one page per pub, and the source row names the brand hosts that chain publishes
the same menu on.

## What counts as a price

`lib/harvest/ukPriceCrawl.ts`, and both lanes go through it unchanged.

* **Verbatim.** A figure is kept only if it appears literally in the text of the
  page that was read.
* **A drink word beside it,** and the NEAREST one decides the category, because
  a menu puts its lines next to each other and the first pattern in a table
  would file every wine on the page as a beer.
* **Its own category's band.** £14 is a fair cocktail and an impossible pint.
* **No food word,** checked after the drink word, so a steak-and-a-pint meal
  deal is not the price of the pint.
* **No offer wording.** "2 for £9", "only £5.99" and "wines from £5.50" all
  state a number a drinker cannot walk in and pay for one named drink. The first
  run of this crawler wrote a Brewers Fayre happy hour onto 27 pubs as the price
  of a beer, which is why this rule exists.
* **The page has to be a list.** Four priced drink lines. One or two is a
  banner, and a banner is where the offers live.
* **An estate page must NAME the pub.** A host serving one pub is that pub's own
  site. A host serving an estate is not, and attributing its home page price to
  every pub on it turns one figure into hundreds of wrong ones.

Every rejection is counted under its own reason and printed. A skip is a
finding: "we crawled 7,000 sites and found 900 prices" is only honest beside the
reasons the other 6,100 gave.

## What comes out

`data/uk_prices/harvest_report.json` and `data/uk_prices/rendered_report.json`
carry the counts. `data/uk_prices/site_harvest.jsonl` is the published copy of
the accepted rows, so the bundle rebuilds from the tree rather than from a
working directory nobody commits. `public/data/uk_prices/README.md` owns the
bundle itself.

Nothing here writes to a price surface. Publishing is the bundle builder, and it
is a separate, deliberate step.
