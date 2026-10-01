# Gin section/item measure source finding

Source-only, UNRUN. Reader current SHA256 `e06986c7509fcdf02898d603ee60c34c20a536223fd0166d2422eb51ed861073`. No production/test edits.

Requested synthetic input `Gin 25ml\nGordons 50ml £8` is rejected by the existing guard, by source trace: `Gordons` alone does not match `gordon's`/`gin` vocabulary; item-label category is null, `statedWineIdentity` still identifies the inline 50ml, and lines 774-778 reject an identity without an item category. Thus that exact spelling does not demonstrate false 25ml publication.

Reachable adjacent counterexample: `Gin 25ml\nGordons Gin 50ml £8`. Own label explicitly identifies Gin; inline identity carries 50ml, but it is not wine. The guard at lines 774-778 permits this because item category is Gin. £8 passes Gin band; no offer/food/mixer words; beer-only half/bottle guards do not apply. Return line 815 sets section 25ml without consulting inline 50ml. Expected current extraction by source is Gin £8, label `Gordons Gin 50ml`, servingSize `25ml`. This conflicts with printed item measure and can falsely enter the 25ml comparison group. No publisher claim or actual execution established.

Minimal Root test-first probes at public `readVenueDrinkPrices(text, "text")` seam:

```ts
expect(readVenueDrinkPrices("Gin 25ml\nGordons Gin 50ml £8", "text").kept)
  .toEqual([expect.objectContaining({ category: "gin", priceGbp: 8, servingSize: "50ml" })]);
expect(readVenueDrinkPrices("Gin 25ml\nGordons Gin £4", "text").kept)
  .toEqual([expect.objectContaining({ category: "gin", priceGbp: 4, servingSize: "25ml" })]);
expect(readVenueDrinkPrices("Gin\nGordons Gin £4", "text").kept[0]?.servingSize)
  .toBeUndefined();
```

Preserve existing no-backward-measure Water, Whiskey boundary, Vesper/AF guards and all eight publisher failures. Own explicit item measure must take precedence over section measure; unknown/ambiguous measures must never become guessed authoritative section values. Any production revision remains held for actual Root RED.

`printedDrinkSection` currently scans/splits text prefix per figure (lines 321-325). This is O(figures × preceding text) source cost, not a measured performance failure. No performance cause or new optimization claim made; bounded existing publisher reader cohort can measure it if needed.
