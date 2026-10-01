# R36 retained price quality inventory

Static source/data inventory. No new runtime, publisher read, parser change or publication. Archived native API receipt supplies Prospect lineage. Machine counts, row identities, hashes and diagnostic definitions: `r36-price-quality-inventory.json`.

| Syntactic class | Retained London | Retained overall | Raw London | Raw overall |
| --- | ---: | ---: | ---: | ---: |
| Slash-only | 30 | 94 | 31 | 95 |
| Punctuation-only, including slash | 30 | 95 | 31 | 96 |
| Leading Markdown heading | 139 | 282 | 141 | 284 |
| Percent plus glass, no named drink | 24 | 82 | 24 | 82 |

Classes overlap. 459 distinct retained rows meet at least one syntax class; all459 belong to site-harvest. Raw ledger has462 distinct syntax-flagged observations. Markdown prefixes establish formatting debt, not an invalid offer. Percent/glass labels are exactly `11.5% glass` (44) or `12.5% glass` (38). London uses source coordinates/current slim IDs against committed simplified borough polygons; unknown geography stays unknown.

Explicit AF/zero-alcohol markers: retained296, London258, including98 site-harvest and198 drink-price-update rows. 285 markers occur in alcohol categories. These are review candidates, not verified misclassification: a marker may name an ingredient. Separate named-cocktail heuristic finds150 wine rows and12 spirit-lane rows. No inferred reclassification or serving is authorised.

Prospect of Whitby: recorded native HTTP200/API10 quotes all match current retained and raw category/price/label/source/date. Raw source has26 rows; current bundle has26 site-harvest plus50 drink-price-update rows for that venue/source. Exact shipped shard maps `w204148499` to `venue-16pnwmm`. Raw SHA matches native receipt. Category caps/dedupe explain why bundle counts differ from projected API counts; no new rendered-UI check performed here.

Existing future-reader code/tests already address slash-only wine, heading scope, early named cocktails and explicit zero alcohol. Documented integration parser/backfill ownership stays separate from Core retained-record repair. Those guards cannot rewrite old observations. Seven corrected rows do not establish whole-dataset trust.

Next bounded verification: obtain permitted primary menu context for Prospect's slash, percent/glass and Spritz/AF candidates; reproduce exact projected claims at390/1440 and preserve neighboring valid rows. Reconcile future-parser/backfill owner before any source update. Never turn inventory heuristics into automatic quarantine or guessed serving/category rules.
