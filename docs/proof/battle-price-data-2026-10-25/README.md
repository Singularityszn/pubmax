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

The runs produced 173 candidates. Review published two new observations from the Bull's Head in Chislehurst.
The other 171 candidates were not published by this refresh.
The Single Espresso read repeated an existing observation and adds no new publication.
Some candidates misclassified liqueurs or borrowed neighbouring drink categories.
This bounded data change does not repair the general parser or endorse those candidates.
Existing source observations remain unchanged. The recorded ledger prefix remains byte-for-byte intact.

Source: <https://www.thebullsheadhotel.co.uk/food-drink/>.
New Double Espresso and alcohol-free observations: `2026-10-25T18:14:24.119Z`.
Existing Single Espresso observation: `2026-09-21T18:21:05.365Z`.
The source menu states Single Espresso £2.50 and Double Espresso £3.10.
Its Non-Alcohol Sparkling Wine section states Nooh La Coste Rosé, Glass £8.60.
The source calls its menus sample menus and says prices may change.
These are Listed menu prices. They are not drinker-confirmed prices.
The live source states Royal Parade, Chislehurst, Kent, BR7 6NR.
Its OSM point is `51.410984, 0.076585`.
The curated Bulls Head is in Chislehurst, Bromley at `51.4116, 0.0769545`, approximately 73 metres away.
The bundle builder resolves that identity to `venue-ege2qq`.
GET `/api/venue/venue-ege2qq` returns all three named prices through the existing `priceUpdates` field.

Review selected only the Double Espresso and alcohol-free observations as new bundle input.
`npm run build:uk-price-bundle` generated the ledger copy, public rows and manifest.
`npm run harvest:uk-record-publications` recorded the two new rows with gated page evidence.
The producer read the source again and recorded that evidence time separately.
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
The [bundle reference](../../../public/data/uk_prices/README.md#map-listing-coverage)
names the shared adapter and its eligibility rules.
Unnamed legacy rows remain in their source bundle but do not enter this named menu count.
The index has 26 pub/category entries in this snapshot. The new source observations cover both categories at one pub.

## Correction verification

The restored tests reproduced the duplicate collect key and missing historical bundle row before the correction.
The restored coffee evidence test found 84 historical rows instead of 85.
Seven focused suites now pass all 75 tests with exit 0.
These include the global duplicate check, historical bundle counts, 85-row coffee cohort and retained coverage-cache tests.

The existing builder reproduces the price rows, coverage index and ledger bytes across two runs.
The manifest matches apart from its generation time.
All 4,031 historical ledger rows retain their original bytes. Earlier reconciliation records remain unchanged.
Only the new publication record changes, from three added rows to two.
The page-evidence producer read the permitted source again and recorded its own evidence time.

Chromium checks passed at 1440 by 1000 and 390 by 844 on an isolated local development build.
The server used `127.0.0.1:4319` and `.next-price-contract`.
Both menus show Single Espresso dated 21 September and Double Espresso dated 25 October.
Both alcohol-free menus show the named £8.60 glass with its 125ml wording and 25 October date.
The source links remain on the Bull's Head page. Neither menu run reported a page error.
The coverage panels show positive Listed counts beside zero drinker-confirmed prices.
The coffee panels show the separate 12-café count.
The loaded-pub denominator changes as spatial shards arrive. It is not a city inventory.

`corrected-browser.json` and `corrected-coverage.json` contain the current browser results.
The desktop and mobile screenshots sit beside these files.
`correction-verification.json` records the focused tests, rebuild comparison and historical preservation checks.
This proof covers signed-out local Chromium with mobile emulation. Hosted preview and physical-device checks remain outside this phase.

The outer executor must run `verify:no-mistakes:changed` on the corrected commit before publication.
This assigned phase prohibits lint, static analysis, complete-suite checks and gate control.
This phase does not claim that the configured gate passed.

## Follow-up adapter audit

The first adapter admitted historical section headings and fragments in the alcohol-free category.
The follow-up rejects generic Non-Alcoholic headings, concatenated menu fragments, country-only labels and explicit alcoholic names without low-no evidence.
It also withholds a large-pack label when the source row gives no serving size.
These checks are conservative display restrictions. They do not repair or reverify the historical source observations.
The eligible inventory is recorded in `eligible-menu-audit.json` with each original source date and URL.
The inventory contains 43 named rows. Only 31 site-harvest rows need the new menu bridge.
The 12 publisher-update rows already reach the menu through their existing pack and are not added twice.
The three Bull's Head prices remain unchanged. Single Espresso retains its original 21 September source date.

ABV checking uses the existing product rule in `alcoholTypeForDrink`: up to and including 0.5 percent is low-no.
Full numeric parsing keeps 0.3 and 0.5 percent intact. It no longer reads a fractional digit as an integer percentage.
The adapter also calls the existing `isValidDrinkPriceUpdate` row validator.
No claim here guarantees that every historical category assignment is correct.

An unavailable bundle now returns `null` from the existing per-venue price-update read.
A successful empty read still returns `{ drink: [], food: [] }`.
Five focused suites passed 22 tests after these corrections, including both read states and observed bad-label examples.
The corrected screenshots show the preserved Single Espresso date and the two new observations.
