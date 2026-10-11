# Captain decisions (data)

## 2026-09-22 London drink source refusal

The 2026-09-21 drink-harvest override was removed. It bypassed the recorded robots refusal while still publishing the affected observations. It grants no permission; refused hosts remain excluded by `lib/harvest/sourcePolicy.ts`.

The reconciliation used the main snapshot identified by `currentMainSnapshot` in [`site_harvest_reconciliation.json`](uk_prices/site_harvest_reconciliation.json). That file owns the withdrawal decisions, unresolved mappings, snapshot hashes and row accounting. The [UK price bundle reference](../public/data/uk_prices/README.md#the-rules-that-keep-it-honest) describes later publications that preserve this audit. The generated [bundle manifest](../public/data/uk_prices/manifest.json) owns current publication counts. The reconciliation recorded a hold on its draft PR for unresolved mappings. Exact rejected snapshots and SHA-256 hashes were retained outside the repository.
