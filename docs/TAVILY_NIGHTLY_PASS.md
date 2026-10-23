# Nightly Tavily pass

The nightly pass reads each London pub's own site for drink lines. A drink line is kept only when that same line states a pound price and a serving size (a pint, a half, a schooner, a two-thirds, a millilitre amount, a glass, a bottle, a can, a keg, or a measure), and only on a drinks menu page, a drinks title, a drinks heading, or the page that bound the site. A food menu page or section, a served flag, a closure, hours, an amenity, a phone number and a dish are the page URL and a short verbatim excerpt for a curator. A later read keeps an earlier excerpt it does not restate. A 125ml, 175ml or 250ml glass stays unstated. The page that bound the site is read with the menu pages. A site is bound only when a result states that pub's postcode or its exact street address. Otherwise the venue stays unbound, the candidate URLs are kept for a curator, and no extract credit is spent. It does not write a Confirmed price, a community price, or the UK price bundle.

## Run

```sh
npm run tavily:nightly -- --dry-run --usage-file=./usage.json
npm run tavily:nightly -- --max-credits=50
```

`TAVILY_API_KEY` comes from the environment. A dry run with `--usage-file` makes no network call and writes nothing. A live run reads `GET https://api.tavily.com/usage`, spends only tonight's allowance, and stops when that allowance is gone.

Tonight's allowance is the smaller of the account remainder and the key remainder, minus a reserve of 50 credits, divided by the days left in the UTC month, including today. Pay as you go headroom is ignored. `--max-credits` can only lower that figure. `--reserve` changes the reserve. `--stale-days` defaults to 30. A venue seen today is skipped. A venue last seen at least that many days ago is due again.

Unpriced venues come first, then seed patches and thin boroughs, then the oldest evidence. Seed patches are Soho, Clapham, Shoreditch, Islington, and Camden. Thin boroughs are Barking and Dagenham, Kingston upon Thames, and Hounslow. Two pubs that share a name stay apart by postcode.

The cursor and the curation queue stay in the gitignored nightly directory under `.tavily`, as cursor.json and queue.json. Every queued drink is standing listed. A human promotes a value. The pass never writes `public/data/drink_price_updates`, `public/data/uk_prices`, or Supabase.

## Schedule

This tree does not install a schedule. Two options are written here so a later change can add one. Neither is active.

### GitHub Actions cron

Add this only after the captain says to add the workflow. The job uses the runner in [`docs/CI_RUNBOOK.md`](./CI_RUNBOOK.md). The secret is `TAVILY_API_KEY`.

```yaml
name: Nightly Tavily pass
on:
  schedule:
    - cron: "30 2 * * *"
  workflow_dispatch:
jobs:
  pass:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - run: npm ci
      - run: npm run tavily:nightly
        env:
          TAVILY_API_KEY: ${{ secrets.TAVILY_API_KEY }}
```

### Local launchd

Install this on the Mac that holds the key, from a checkout that will still be there tomorrow. Do not install it from a disposable worktree. The program is `npm run tavily:nightly`. The working directory is that checkout. `StartCalendarInterval` is hour 2 and minute 30. The plist must not contain the key. Load `TAVILY_API_KEY` the same way [`docs/LOCAL_REFRESH_SCHEDULER.md`](./LOCAL_REFRESH_SCHEDULER.md) loads `keys.env`. This document does not write a plist.
