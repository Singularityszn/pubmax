# Places cold lookup repair

Codex review identified a full-pack read on each cold server instance. The original reader parsed 9,236,436 bytes and 3,053 records to return one venue.

`npm run build:places-enrichment` now derives 3,053 files from the committed observations before dev and production builds. Runtime reads only requested canonical OSM identities. The full source pack remains the collection and spend ledger; no Google requests or observation dates changed.

Measured against the committed pack on 4 October 2026:

| Read | Bytes |
| --- | ---: |
| Previous cold source pack | 9,236,436 |
| Requested record, venue-osm-n581058547 | 1,609 |
| Largest generated identity file | 2,097 |

The production-condition server reader returned the requested record byte-for-byte equivalent to its source JSON object. Focused tests forbid full-pack runtime reads, exercise curated/base aliases and ambiguous identities, and run the public builder against Unicode observations and a removed identity. Missing runtime files do not fall back to the full pack.
