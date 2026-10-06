# Google Places enrichment, 4 October 2026

The runner now accepts an explicit pack: `london` remains the default,
`uk_cities` copies hours and contacts, and `london_extras` and
`uk_cities_extras` copy the additional fields. Each pack owns its input hash,
checkpoint and committed spend ledger. Adding the UK ledger leaves the London
resume unchanged.

The three new packs share a USD 28 task cap across resumes, fresh clones and
calendar months. The existing London monthly USD 85 cap remains unchanged.
Every request reserves its full tariff before sending, including failed
requests. Free allowance is not assumed. Core requests reserve USD 0.020;
extras reserve USD 0.025, the Enterprise + Atmosphere rate.
[Google pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
was checked on 4 October 2026.

## Live collection

The dry run planned 1,400 of 3,166 UK-city requests for USD 28. Monitoring
reported 18,482 Places requests already made this month. Credentials were
loaded only into the live command, without logging them.

The live run completed 1,400 requests for 1,400 pubs, with no row failures:

| Copied field | Pubs |
| --- | ---: |
| Address | 1,400 |
| Opening hours | 1,334 |
| Phone | 1,201 |
| Website | 1,057 |

Spend is USD 28 at the published request tariff, not an invoice measurement.
The runner restored the previous daily quotas: SearchText 100, GetPlace 60.
Subsequent dry runs for all three new packs planned zero requests.

The cap leaves 1,766 UK-city core rows and all 6,219 extras rows unfetched.
No rating, price-level or amenity value was invented to fill those gaps.

## App delivery

The build combines the four explicit packs by exact OSM identity and verified
Google place ID. Each copied field retains its own observation date.
Conflicting Google IDs remain separate so the existing reader refuses an
ambiguous match.

The existing Google details panel supports rating, rating count, Google price
level, editorial summary, amenity chips, accessibility chips and payment chips.
Amenity chips cover outdoor seating, beer, wine, cocktails, room for groups,
live music, live sport, dogs allowed, breakfast, brunch, lunch, dinner,
vegetarian food, a children's menu, bookings and toilets. Payment chips cover
credit cards, debit cards, contactless and cash only. Every extras field is
billed under the same Enterprise + Atmosphere request. A Google price
level never becomes a pint price. Outdoor seating never implies a beer garden.
Only stated access facts produce positive accessibility chips. Every displayed
Google field keeps its `Checked <date>` credit.

The freshness stamp is dated by the oldest copied row across every published
pack, and records each pack's input hash, oldest row, spend and summary. Both
the builder and every runner save rewrite it, so a fresh London refresh cannot
hide older UK-city or extras rows.

The real venue API for `venue-mcr-iy010v`, Grove Alehouse, resolves the collected
record for `venue-uk-n13828223501`, including hours, address, phone and website.
Extras display tests use fixtures because no live extras fit the task budget.

## Commands

```sh
npm run enrich:google-places -- --dry-run --usage --pack=uk_cities
npm run enrich:google-places -- --write --exclusive --pack=uk_cities
npm run enrich:google-places -- --dry-run --pack=london_extras
npm run enrich:google-places -- --dry-run --pack=uk_cities_extras
npm run build:places-enrichment
```

`--exclusive` confirms that other shared-key jobs have finished. The same
`--refresh` age checks and per-row HTTP failure handling apply to every pack.
The task cap is exhausted; none of these commands authorizes further spend.

## Browser evidence

Local Next development preview, private port 3188 and isolated
`.next-places-enrich` output. No network or CPU throttling. The real Grove
Alehouse flow opened its Manchester venue sheet, expanded practical details,
and opened the copied weekly hours. Desktop viewport was 1440 × 1000;
mobile emulation was 390 × 844, touch enabled, device scale factor 1. Both
rendered the observation credit without horizontal document overflow.

- [Real UK core fields, desktop](uk-core-desktop.png)
- [Real UK core fields, mobile](uk-core-mobile.png)
- [Extras display fixture, desktop](extras-fixture-desktop.png)
- [Extras display fixture, mobile](extras-fixture-mobile.png)

Extras screenshots use a browser-only interception of a local venue response.
The fixture text identifies itself on screen. Desktop uses Peveril of the Peak;
mobile uses Castle Hotel. They prove layout, labels and dated credits, not
Google observations for those venues. No fixture was written to a dataset.
The final browser console had no error messages.

## Inspector regression

Before the fix, opening the Manchester inspector reached this browser error:

```text
TypeError: Cannot read properties of undefined (reading 'map')
lib/areaNews.ts:94: LONDON_BOROUGHS.map(...)
```

The regression test reproduces that module-initialization failure with an
unavailable borough-helper export. Area news now imports the canonical borough
names directly from their dependency-free module. The test confirms London
names still resolve and Manchester areas do not become London boroughs.
The real Manchester inspector subsequently opened and produced the core-field
screenshots above.

## Validation

`DEPLOYMENT_VERSION=local npm run verify` exited 0 before the review fix
round. That run predates the extras fields, payment chips and all-pack freshness
stamp. Coverage reported 19,304 passing tests and six skipped tests. The separate RLS
run passed 465 tests, and the isolated shared-memory suite passed 10 tests.
Data validation, lint, database type drift, TypeScript, dead-code, freshness,
install-script policy and dependency audit gates passed. Freshness retained
its three advisory store feeds that cannot be measured without credentials.

After the review fix round, the Places enrichment, builder, runner, rendering
and freshness test files passed, as did TypeScript and lint on the changed
files. The full verify gate is rerun by the pipeline test step; its result is
not recorded here.

The runner regression covers London resume isolation, UK publication, failed
paid attempts and the shared task cap after deleting a local checkpoint.
The builder regression proves UK records reach runtime files and extras retain
the original contact observation dates. Rendering tests cover invalid extras,
explicit false amenities, payment chips and different rating/count
observation dates.
