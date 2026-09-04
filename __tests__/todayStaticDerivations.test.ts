import { describe, expect, it } from "vitest";

import { buildTodayPintsIndex } from "@/app/today/todayPints";
import { getPricedVenues, resetVenuePriceIndexForTests } from "@/lib/venuePriceIndex";

// /today derives two things from the bundled price dataset that are identical
// for every reader and every request. `getPricedVenues()` memoises the 6.7 MB
// parse and hands back the SAME array for the life of the process, which is what
// makes an identity-keyed memo of those derivations correct rather than a cache
// somebody has to remember to clear.
describe("the priced dataset is one array per process", () => {
  it("hands back the identical array, so a derivation may be keyed on its identity", async () => {
    const first = await getPricedVenues();
    const second = await getPricedVenues();
    expect(second).toBe(first);
  });

  it("hands back a DIFFERENT array once the dataset is re-read, so a memo cannot go stale", async () => {
    const first = await getPricedVenues();
    resetVenuePriceIndexForTests();
    const afterReset = await getPricedVenues();
    expect(afterReset).not.toBe(first);
    // Same data, so a WeakMap keyed on identity simply derives afresh rather
    // than answering with the previous process-lifetime value.
    expect(afterReset.length).toBe(first.length);
  });
});

describe("buildTodayPintsIndex stays pure", () => {
  it("is a function of the venues alone, so memoising its result changes nothing a reader sees", async () => {
    const venues = await getPricedVenues();
    const a = buildTodayPintsIndex(venues);
    const b = buildTodayPintsIndex(venues);
    // Two separate objects (it is not itself memoised), carrying equal content.
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
  });

  it("reads no clock, so the same venues answer the same index at any moment", async () => {
    const venues = await getPricedVenues();
    const a = buildTodayPintsIndex(venues);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(buildTodayPintsIndex(venues)).toEqual(a);
  });
});
