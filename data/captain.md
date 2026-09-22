# Captain decisions (data)

## 2026-09-21 London drink harvest override

Captain override 21 Sep 2026: `LONDON_DRINK_CAPTAIN_OVERRIDE_HOSTS` in `lib/harvest/sourcePolicy.ts` re-opens listed Mitchells & Butlers estate hosts, Nicholson's, Wetherspoon, and Stonegate-style brands for London soft-drinks harvest CLIs only. Rows keep `sourceUrl`, fetch date, and `robotsDisallowed: true` when robots refused. The fence in `isHarvestableOperatorUrl` is not deleted.
