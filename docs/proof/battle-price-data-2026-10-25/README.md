# Price refresh and non-beer coverage

Base: `a87240e748c859556b3604db508db257af96ca03`.

The baseline pint refresh remains blocked. Running
`node --conditions=react-server --import tsx scripts/refresh_pint_price_observations.mjs --report-only`
exited 1 before a request. The source policy has no permitted `pint-prices-com` row.
This change does not grant that permission or update baseline collection dates.
A real drinker contribution remains unmet. This work creates no community or production records.

## Source reads

The existing document pipeline read three permitted first-party hosts on 25 October 2026.
Each run used `--london --only <host> --hosts 1 --pages 8 --concurrency 1`.
The hosts were `thescolthead.co.uk`, `threecrownsn16.com` and `thebullsheadhotel.co.uk`.
The live robots checks admitted all three. The committed harvest report describes those bounded reads.
It does not establish global freshness.

The runs produced 173 candidates. Review selected three observations from the Bull's Head in Chislehurst.
The other 170 candidates were not published by this refresh.
Some candidates misclassified liqueurs or borrowed neighbouring drink categories.
This bounded data change does not repair the general parser or endorse those candidates.
Existing source observations remain unchanged.

Source: <https://www.thebullsheadhotel.co.uk/food-drink/>.
Observation: `2026-10-25T18:14:24.119Z`.
The source menu states Single Espresso £2.50 and Double Espresso £3.10.
Its Non-Alcohol Sparkling Wine section states Nooh La Coste Rosé, Glass £8.60.
The source calls its menus sample menus and says prices may change.
These are Listed menu prices. They are not drinker-confirmed prices.
The live source states Royal Parade, Chislehurst, Kent, BR7 6NR.
Its OSM point is `51.410984, 0.076585`.
The curated Bulls Head is in Chislehurst, Bromley at `51.4116, 0.0769545`, approximately 73 metres away.
The bundle builder resolves that identity to `venue-ege2qq`.
GET `/api/venue/venue-ege2qq` returns the three named observations through the existing `priceUpdates` field.

Review selected the three source observations as input to the existing bundle builder.
`npm run build:uk-price-bundle` generated the ledger copy, public rows and manifest.
No observation timestamp came from a rebuild timestamp.

## Coverage behaviour

Before this change, the map's drink picker showed only confirmed non-beer coverage.
A zero confirmed count concealed the separate Listed menu supply.
The picker now shows a separate Listed coffee or alcohol-free count for loaded pubs.
The newest source-read date accompanies that count. It is not a claim that every row has that date.
Cafés remain outside the pub count. Failed reads do not become zero coverage.
The existing drinker-confirmed count and map price authority remain unchanged.

The bundle builder publishes `listed_coverage.json`, a compact index of eligible coffee and alcohol-free listings.
The browser intersects that index with loaded pub IDs and rechecks observation age.
The existing per-venue menu reader also carries named Listed coffee and alcohol-free bundle rows.
Both the index and menu adapter reject coffee liqueurs and ambiguous neighbouring labels.
Plain coffee servings use a narrow name list. Explicit alcoholic ABV labels cannot enter the alcohol-free adapter.
Unnamed legacy rows remain in their source bundle but do not enter this named menu count.
The index has 31 pub/category entries in this snapshot. The new source observations cover both categories at one pub.

## Verification

The initial publication test failed because the helper read the wrong decision date field.
The corrected helper uses the shared standing decision's `asOf` field.
Targeted reader and rendered-component checks cover identity deduplication, loaded scope, separate confirmations, source dates and failed reads.
A clean worktree-local `npm ci --ignore-scripts` installed 784 packages and reported zero vulnerabilities.
`npm run typecheck` passed. `npm run validate-data` passed all 22 datasets.
The validation also reported existing stale `area_news` and `google_places_content` advisories.
The seven targeted suites passed 60 tests with worktree-local dependencies.
The local Chromium check used a private dev server at `localhost:4312`, isolated `.next-price`, and a 1440 by 1000 viewport.
The Menu tab displayed both espresso prices, their publisher and the 25 October source date.
The alcohol-free menu displayed Nooh La Coste Rosé at £8.60 with its publisher and date.
The coffee picker showed zero of 175 loaded pubs confirmed, one Listed pub and 12 separate Shoreditch cafés.
The alcohol-free picker showed zero of 175 loaded pubs confirmed and one Listed pub.
The loaded-pub denominator changes as spatial shards arrive. It is not a city inventory.
The captured runtime reported no page errors. Screenshots and DOM text are beside this report.
This is local signed-out desktop proof. It does not prove a hosted preview or physical phone.
Full `npm run verify` and the publication gate remain pending the coordinator's resource slot.
