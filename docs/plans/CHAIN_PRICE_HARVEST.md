# Chain menu price harvest: permission granted, prices absent

PR 2 of the captain's 3 September decision. The brief: extend the first-party
lane to chain menus whose robots and terms permit reading, UK-wide, starting
with Greene King and Wetherspoon, and resolve the Nicholson's contradiction by
re-reading robots today.

All three were re-read live on **3 September 2026**. The answer is that
permission is no longer the binding constraint, and supply is.

## The re-read

| Chain | robots.txt, 3 Sep 2026 | May we read it? | Does it publish a pint price? |
| --- | --- | --- | --- |
| Greene King | HTTP 200, plain rules file | **Yes** | **No** |
| J D Wetherspoon | HTTP 200, allow-all, `Crawl-delay: 10` | **Yes** | **No** |
| Mitchells & Butlers (Nicholson's) | **HTTP 403**, Cloudflare challenge page | **No** | Yes, and we may not read it |

### Greene King: permitted, and the document holds no price

`robots.txt` disallows infrastructure paths only, `/App_Data/`, `/bin/`,
`/media/`, `/sitecore/`, `/js/`, `/css/` and the booking query strings. The one
blanket `Disallow: /` is aimed at Screaming Frog. Pub and menu paths are
permitted, and no rendering-crawler class is named.

The refusal is therefore not about permission. A per-pub menu page,
`/pubs/greater-london/sherlock-holmes/menu`, answered 200 with 150 KB and **not
one price**. It is a Sitecore JSS application that renders its menu in the
browser, and the served HTML carries no embedded price JSON either. The
site-published `/api/cards` endpoint, which robots explicitly allows by name,
answered 500.

The 1,538 Greene King rows already in `public/data/drink_price_updates` say the
same thing from the other direction: they are 863 wines and 675 cocktails, with
no beer among them.

### Wetherspoon: 828 permitted menu pages, and the pages say the prices are elsewhere

`robots.txt` is `User-agent: *` with an empty `Disallow:` plus `Crawl-delay: 10`.
The sitemap index publishes `pub-menus-sitemap.xml` listing **828 per-pub menu
pages**, every one of them permitted.

The page states its own answer in its own copy:

> Download our app. **See pricing** and effortlessly order food and drinks to
> your table.

It offers a PDF table menu and allergen information. The prices are in the app.
Reading the app would need an agreement, not a crawler.

### Nicholson's: still unreadable, so it stays refused

`https://www.nicholsonspubs.co.uk/robots.txt` answers **HTTP 403** with a
Cloudflare `Attention Required!` challenge page rather than a rules file. No
permission can be read, so the estate stays refused, unchanged from the
2026-08-09 verdict, exactly as the brief specified.

This is the sharpest fact in the whole track: **the one chain that does publish
per-drink prices on the web is the one chain we may not read.** That asymmetry is
the entire argument for asking Mitchells & Butlers for permission or a feed. It
is the single largest available lever on price coverage.

## The contradiction, settled

`data/price_sources.json` marked Nicholson's `permissible: true` while
`lib/harvest/sourcePolicy.ts` refused the Mitchells & Butlers estate on
`robots-unreadable`. 1,914 Nicholson's rows shipped on the refused side of that
disagreement.

Three changes close it:

1. **Price sources now live in `sourcePolicy` at all.** The table had no price
   kind, which is how the two tables could disagree without anything noticing. A
   `chain-menu-prices` kind now carries all three chains, each with its live
   re-read recorded as evidence.
2. **`data/price_sources.json` marks both Nicholson's entries `permissible: false`**
   and says why. The rows are kept rather than deleted, because a source that
   vanishes is a gap nobody notices.
3. **`__tests__/priceSourceGovernance.test.ts` fails the build if they drift
   apart again.** The narrower answer binds: a source is usable only when it is
   permissible in the allowlist AND not refused on permission by `sourcePolicy`.

## A new skip reason, because two different things were being called one

`publishes-no-web-price` joins the closed set. A chain that admits us and keeps
its prices in an app has told us yes; recording that as `robots-disallowed`
would be a false statement about a host that gave permission, and dropping the
source from the table would lose the finding entirely.

That distinction is load-bearing beyond the wording. `REFUSED_HOSTS`, which bars
a host from being used as a venue's own operator URL anywhere in the harvest, is
now derived from `isRefusedOnPermission` rather than from every refusal. Without
that split, recording Greene King and Wetherspoon as empty would have barred
their own pub pages from every other lane, on hosts that said yes.

## The lane

`npm run harvest:chain-prices`, `scripts/harvest_chain_menu_prices.mjs`, with the
rules in `lib/harvest/chainMenuPrices.ts`.

Three rules, and they are the design:

1. **The source table decides, not the caller.** Pages come from
   `sourcePolicy`, kind `chain-menu-prices`, allowed rows only. There is no
   `--url` flag: a source absent from the table is not read at all.
2. **Permission is re-asked live.** The table records a verdict and the day it
   was checked, but a host can change its mind between runs, so `robots.txt` is
   fetched again each run through `lib/harvest/robots.ts`, once per host, and an
   unreadable `robots.txt` is a refusal. Crawl-delay is honoured from the source
   row, the user agent names PUBMAXX and the public contact, and a run is capped
   at its own page budget.
3. **A price must be on the page.** Every figure is verbatim-checked against the
   page text, needs a drink word within 80 characters, and is dropped on a food
   word or outside the £2 to £12 pint band. A page that states no price at all
   reports `no-price-on-page` rather than an empty list, because "we read it and
   it says nothing" is a finding.

**Nothing is written straight through to the price store.** The rows are
reported and a reviewed publish remains a separate, deliberate step. A harvest
that could write directly to a reader-facing price would be one bad selector away
from putting an invented figure on a pub.

## Coverage per city

Today, from `data/osm/chain_menu_price_harvest_log.json`:

| City | Pages read | Venues priced |
| --- | --- | --- |
| London | 0 | 0 |
| Manchester, Liverpool, Oxford, Durham, Glasgow, Bristol, Cambridge, Bath, Llandudno | 0 | 0 |

Zero pages were read because zero sources are currently allowed, and each of the
three is skipped with its own reason and check date printed. The lane's own
tests cover the case where a page does state a price, because an untested
harvester that yields zero is indistinguishable from a broken one.

## What would change the number

In order of size:

1. **Ask Mitchells & Butlers for permission or a feed.** They publish the prices.
   We cannot read them. Everything else on this list is smaller.
2. **Watch for Greene King server-rendering its menu.** Permission is already in
   hand; the only missing piece is a price in the document. Re-running the lane
   answers this in one command.
3. **Ask Wetherspoon whether the PDF table menu can carry prices**, or for a
   feed. 828 permitted pages are already waiting.
4. **The confirmed Pint Drop lane** (PR 1's named follow-up). It is the only
   supply that grows with the product rather than with somebody else's
   publishing decisions, and none of the three chains above can block it.
