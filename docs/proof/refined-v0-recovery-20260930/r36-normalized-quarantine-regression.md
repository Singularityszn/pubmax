# Normalized quarantine regression

Status: SOURCE ONLY, UNRUN. No implementation or generated data changed.

`__tests__/ukPriceBundle.test.ts` now covers both evidenced raw labels and their upstream canonical wine representations: Bell £4 London Pride plus 500ml, and Gallimaufry £3 Ting Grapefruit Soda plus 330ml. The normalization output was checked against `lib/siteHarvestLedgerCore.ts` at upstream main `af5a08f78afad1091efc7ed97d1906daf9b47db1`; this is not an executed combined-builder result.

Each case requires both forms to remain outside parsed, authoritative, category and named-menu projections. Controls change one of source, amount, drink, typed measure, category or producing lane. Controls are synthetic policy inputs, not published claims or proof those prices exist.

For the canonical form, the source-stated 500ml/330ml measure is part of the exact evidenced identity. The different-measure control requires narrow matching, as the different-price control does; it does not declare beer or soda to be valid wine. The raw-label signature remains intact. These reader cases do not execute ledger normalization or regeneration; combined-builder coverage and native evidence remain required after integration.

Current policy rejects the raw form but compares its label exactly, so the canonical form is expected to fail the rejection assertion. Capture that failure under a fresh runtime grant before a production repair. Then reconcile raw admission before normalization with canonical read admission and preserve upstream same-wine serving dedupe. Do not replace the quarantine table, reclassify drinks, guess measures or copy generated data from main.

Focused command, UNRUN:

```sh
./node_modules/.bin/vitest run __tests__/ukPriceBundle.test.ts -t 'withholds the normalized wrong-wine claim'
```

Full source, regeneration and native gates remain pending. Prior R35 verification applies only to its recorded freeze.
