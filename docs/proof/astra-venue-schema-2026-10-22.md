# Venue schema check, 22 October 2026

The Hatton canonical page already contains grounded `BarOrPub` JSON-LD. Its `/pubs/venue-1vle947` page points search engines to `/ledger/venue-1vle947` and remains `noindex`, as ADR 0017 requires.

A separate error appeared in the same schema owner. Live `/ledger/restaurant-rules` and `/ledger/food-best-turkish-kebab` both emitted `BarOrPub`. Their venue records classify them as `restaurant` and `food`.

The Ledger now emits this schema only for pub and bar records. [Schema.org defines BarOrPub as a bar or pub](https://schema.org/BarOrPub). The existing venue-kind rule keeps legacy pub records without an explicit kind eligible. Other kinds receive no replacement type from this change.

Names, canonical URLs, addresses, coordinates and listed-building facts keep the existing serializer. This adds no price, review, opening-hour, cuisine or food-business claim.

## Evidence

The source baseline was `e81aaa6a0`. Read-only live HTML is retained locally under `artifacts/astra-venue-schema-1022/`. `live-schema-before.json` contains the extracted pub, bar, restaurant and food records. The live assertion failed because Rules was labelled `BarOrPub`.

`__tests__/ledgerJsonLd.test.tsx` renders the actual Ledger page through the venue lookup. Before the change, the restaurant and food cases failed. The pub and bar cases passed. The corrected cases preserve the Hatton and American Bar schemas and omit the incorrect restaurant and food schemas.

The focused run passed 88 tests across six files. Scoped ESLint and `git diff --check` passed. The [combined reconciliation record](astra-battle-reconcile-2026-10-22.md#final-local-verification) owns final verification results and hosted-proof limits. This work made no deployment, data, environment, billing or production-write change.
