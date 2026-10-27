# Dataset identity recheck, 27 October 2026

The live recheck covered 21 HTML routes. Every captured JSON-LD block parsed as JSON. The earlier founder, About page and historic citation identity repairs remain present.

Two live dataset pages still describe PUBMAXX through anonymous Organization objects. A third emitter has the same shape when the current Pint Index contains observations. JSON-LD consumers cannot identify those anonymous nodes as the site's existing Organization from a shared name alone.

| Page | Role | Before | Corrected reference |
| --- | --- | --- | --- |
| `/spoons-value` | Publisher | Anonymous Organization named PUBMAXX | `https://pubmaxxing.com/#organization` |
| `/pint-index` with observations | Creator | Anonymous Organization named PUBMAXX | `https://pubmaxxing.com/#organization` |
| `/pint-index/2026-06` | Creator | Anonymous Organization named PUBMAXX | `https://pubmaxxing.com/#organization` |

[Live identity excerpts](live-before.json) record the two public responses. The current live Pint Index has no observations and correctly emits no Dataset. Its populated case is covered through a controlled snapshot at the page-rendering boundary.

The correction uses the existing shared organization ID. The Spoons dataset retains Oliver Clegg as its creator. Dataset dates, source links, figures, downloads, empty-state rules, script escaping and request nonces are unchanged.

The regression tests execute the actual page functions, render their HTML, and parse their JSON-LD scripts. Each changed emitter failed its identity assertion before correction. The final focused run passed 21 tests across six files, including previous homepage, historic citation, serialization and download checks. Five new cases cover the Spoons publisher, populated live Index, populated and empty archived editions, and the absent live Dataset.

`npm run verify` exited successfully. The unit coverage run passed 43,986 tests with one existing skipped test. PostgreSQL RLS checks passed all 697 tests. The map contract suite passed eight tests, and the RLS timeout suite passed ten tests. Lint reported zero errors and three existing complexity warnings. Freshness checks reported two advisory stale datasets and three stores that this keyless runtime cannot measure.

[Rendered identity excerpts](rendered-after.json) record the corrected roles from actual page functions rendered through React DOM server. The Spoons case uses bundled data. The Pint Index cases use controlled snapshot fixtures at the server data boundary. The shared site graph supplies the referenced Organization. This proves rendered output, not a built or hosted preview.

Schema.org Validator reported zero errors and zero warnings for each of the four captured Dataset cases. Each test detected one Dataset and one WebSite. Google's Rich Results Test detected a valid Dataset and Organisation for both the corrected Spoons markup and the populated live Index fixture. Each Dataset has one advisory for the optional `license` field. No verified licence exists in the source provenance, so this change does not invent one.

The saved Vercel setting still reads `Don't build anything`, with command `exit 0`. The user requires explicit build permission. No production build, preview deployment or production deployment was run. The PR uses `[skip ci]` to prevent GitHub Actions from starting build jobs. Hosted build checks remain pending until the user permits them. Validator success does not guarantee a Google search appearance.

References: [JSON-LD node identifiers](https://www.w3.org/TR/json-ld11/#node-identifiers), [Google guidance on linking structured data items](https://developers.google.com/search/docs/appearance/structured-data/sd-policies#multiple-items), and [Dataset documentation](https://developers.google.com/search/docs/appearance/structured-data/dataset).
