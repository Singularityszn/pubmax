# Round drink lines and the bill rule

Security audit, October 2026, finding "Round drink lines write community prices
without the bill photo both price doors require".

The Round composer at 390 px wide, in itemise mode, with one typed Guinness at
£6.20. Captured from a keyless `next dev` server with Chrome headless.

- `composer-before-390.png`: main. The composer says a typed line counts as a
  price log, and the route promoted it with no bill.
- `composer-after-390.png`: this change. The route keeps a line without a bill
  in the diary, and the composer now says so.

The route cases are in `__tests__/roundsRoute.test.ts`.

The route retains each valid bill through `uploadPhoto("receipt", venueId, spendId, file)`.
Both Round store backends keep its returned key on the spend as `receiptPhotoKey`.
The database column is `round_spends.receipt_photo_key`, added by migration `0199`.
Each promoted line references the spend through `roundSource { spendId, lineIndex }`.
A retry keeps the original key and does not upload the bill again.

A bad image returns 400 before the route saves the spend.
A Storage outage logs the loss and preserves the spend.
Until migration `0199` is applied, the database store saves the spend without its receipt key and logs the loss.
The migration and its rollback are supplied for the captain to apply.

The receipt cases are in `__tests__/roundsRoute.test.ts` and `__tests__/roundsReceiptStore.test.ts`.
