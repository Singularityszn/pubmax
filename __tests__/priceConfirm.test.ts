import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetPriceConfirms,
  confirmPrice,
  readPriceConfirm,
} from "@/lib/priceConfirmStore";

// With no Supabase env configured (the default under vitest), the store selects
// its process-memory backend. These pin the honest-tally contract the durable
// backend must also satisfy: distinct-actor counting, per-actor de-dup, the
// price envelope, and fail-soft empties on bad input.
//
// Vercel's CI presets real SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, which would
// otherwise flip priceConfirmStore() over to the durable Supabase backend mid-
// suite — hitting a live, cross-run-persistent table these "memory backend"
// assertions never intend to exercise. Neutralize them like
// importNotesRoute.test.ts / planCardRoute.test.ts do.
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("priceConfirmStore (memory backend)", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    __resetPriceConfirms();
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
  });

  it("counts distinct actors and de-dupes a repeat tap", async () => {
    const first = await confirmPrice({ venueId: "v1", priceGbp: 4.2, actor: "a" }, 1_000);
    expect(first.confirms).toBe(1);
    expect(first.lastConfirmedAt).toBe(1_000);

    const second = await confirmPrice({ venueId: "v1", priceGbp: 4.2, actor: "b" }, 2_000);
    expect(second.confirms).toBe(2);

    // Same actor re-taps: refreshes the timestamp, never inflates the count.
    const repeat = await confirmPrice({ venueId: "v1", priceGbp: 4.2, actor: "a" }, 3_000);
    expect(repeat.confirms).toBe(2);
    expect(repeat.lastConfirmedAt).toBe(3_000);
  });

  it("keys the tally by (venue, price) so a different price is a fresh count", async () => {
    await confirmPrice({ venueId: "v1", priceGbp: 4.2, actor: "a" }, 1_000);
    const other = await readPriceConfirm({ venueId: "v1", priceGbp: 4.5 });
    expect(other).toEqual({ confirms: 0, lastConfirmedAt: null });

    const same = await readPriceConfirm({ venueId: "v1", priceGbp: 4.2 });
    expect(same.confirms).toBe(1);
  });

  it("rejects out-of-envelope and empty inputs with an empty tally, never throwing", async () => {
    expect(await confirmPrice({ venueId: "", priceGbp: 4.2 })).toEqual({
      confirms: 0,
      lastConfirmedAt: null,
    });
    expect(await confirmPrice({ venueId: "v1", priceGbp: 0 })).toEqual({
      confirms: 0,
      lastConfirmedAt: null,
    });
    expect(await confirmPrice({ venueId: "v1", priceGbp: 5_000 })).toEqual({
      confirms: 0,
      lastConfirmedAt: null,
    });
  });
});
