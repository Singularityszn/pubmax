# Live JSON-LD audit, 27 October 2026

The public deployment reported commit `1aa95f7f6d9d42b8472fb57ea39462a9a9035d12`. Twelve public routes returned HTTP 200 and parseable JSON-LD with production canonical URLs. `live-audit.json` records the deployment, routes and relevant graph excerpts.

## PR #2346 is present on live

| Repair | Live result |
| --- | --- |
| Founder identity | Personal X and GitHub profiles belong to the founder Person. Organization claims neither profile. |
| Shared graph | AboutPage references the shared Organization and WebSite IDs. The public contact email remains available. |
| The Grapes | Its Wikipedia identity remains. The photographic print is not a `sameAs` identity. |
| Black Lion | Conflicting identity URLs are omitted from `sameAs`. |

## Remaining issue and repair

Black Lion still emits one `LandmarksOrHistoricalBuildings` node whose description says Kilburn while its address and coordinates identify Hammersmith. The official [Kilburn pub contact page](https://blacklionkilburn.co.uk/contacts/) names 274 Kilburn High Road. The official [Hammersmith pub contact page](https://www.blacklion.london/contact) names 2 South Black Lion Lane. These are different pubs.

Removing `sameAs` alone does not resolve that combined place claim. The follow-up emits a `WebPage` with the record's name and canonical page URL when multiple identity references remain unresolved. It omits the combined description, location and identity claims. Visible citations and generated datasets remain unchanged.

Ten of the 342 bundled records have multiple distinct Wikipedia or Wikidata identity references. Some references may be aliases. The existing policy treats these identities as unreconciled until evidence establishes equivalence. This repair follows that same conservative boundary. Records with one identity keep their landmark markup, including The Grapes and Prospect of Whitby.

## Regression and validation

The existing rendered historic-page test is the public test boundary. Its Black Lion assertion failed before repair because the node was a landmark. The repaired output passed all 63 targeted tests across nine files. Existing serialization, About, founder, contact, ledger and drink-landing checks passed.

`npm run verify:no-mistakes` ran the full `npm run verify` bar and passed. It recorded 43,981 unit tests passed, one existing configured skip, 697 database tests passed and 10 harness tests passed. The dependency audit reported no high or critical vulnerabilities. Freshness reported two advisory stale datasets and three store feeds that a keyless run cannot measure. These were not reported fresh.

The isolated local production build passed through `scripts/run-with-restored-next-env.mjs`, with revision stamps pinned to `local`. It used `.next-schema-prod` and no application credentials. Generated bundled data was restored after the build.

The production server listened only on `127.0.0.1:6427`. All 21 checked HTTP routes returned 200 and production canonical URLs. Every route retained the shared Organization and founder graph. The About and Grapes assertions passed. All ten unreconciled records emitted WebPage without description, address, geo or sameAs, while retaining their identity citation links in the visible document. The owned server exited and its port was clear afterward. `candidate-http.json` records the route results and corrected Black Lion graph.

These local checks exercised the edited source before its delivery commit. The delivery gate validates the committed candidate separately. No merge or deployment is part of this task.

## Limits

This repairs JSON-LD assertions. It does not reconcile the underlying historic source records or establish Google rich-result eligibility. Historical facts remain attributed to their visible sources. Local checks cannot establish a future production deployment.

## Standards

- [Schema.org sameAs](https://schema.org/sameAs) identifies the same entity.
- [Schema.org WebPage](https://schema.org/WebPage) describes a page.
- [Google structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) require representative, non-misleading markup.
