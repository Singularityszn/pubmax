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

The [bill rule](../../rules/lib-images-uploads-and-photo-walls.md#a-new-price-comes-with-the-bill-and-the-pint-photo-is-the-fun-one)
owns receipt storage, migration requirements, retry cleanup, and failure handling.

The receipt cases are in `__tests__/roundsRoute.test.ts` and `__tests__/roundsReceiptStore.test.ts`.
