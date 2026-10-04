# Parallel discovery first batch, 4 October 2026

Local production-build evidence, served at `127.0.0.1:3326`. This is not deployment evidence.

| City | Before | After | New venues |
| --- | ---: | ---: | ---: |
| Birmingham | 295 | 299 | 4 |
| Leeds | 289 | 296 | 7 |
| Glasgow | 293 | 296 | 3 |

Counts are rows in the city slim packs. Fourteen of 29 researched candidates passed citation, address, geocoding and dedupe checks. Every accepted coordinate in this batch is a postcode centroid. Prices remain null. Sources and observation dates are in each city's `parallel_venues.json`.

Browser checks used `chrome-devtools-axi` with an owned profile outside the repository. A fresh profile avoids reusing the earlier local preview's service-worker cache. No Google Maps or Places content was read or copied.

- [Birmingham desktop](birmingham-desktop.png), 1440 x 900: `/map/birmingham?q=Society` resolves Society Birmingham and opens its bar sheet.
- [Leeds mobile](leeds-mobile.png), emulated 390 x 844: `/map/leeds?sel=venue-lds-1dzk9eh` opens The Cut & Craft Leeds as a restaurant.
- [Glasgow mobile](glasgow-mobile.png), emulated 390 x 844: `/map/glasgow?sel=venue-glw-1w0v1yx` opens Bossa as a bar.

All three sheets show their sourced addresses and no logged beer price. Glasgow's checked browser console contained no errors. Food-hygiene responses are existing live product reads, not facts added by discovery.

Fresh-browser testing found a runtime rejection missed by builder checks: unpriced bars and restaurants lacked the price-anchor fields the slim loader required. The regression test loaded all three real packs and returned `unavailable` before the fix. It now returns `ready`, preserving every row. Priced rows without anchors and partial anchor claims remain rejected. The loader, discovery and existing cache suites passed 74 focused tests; the production rebuild passed.

The full verification run after profile relocation passed 19,286 coverage tests and 465 PostgreSQL tests. Final verification is repeated after committing the runtime correction. The first batch used 33 Parallel HTTP calls, approximately USD 0.350. Twenty-nine further cities remain queued; cities without shipped maps stage data until map registration is added.
