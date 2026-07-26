import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetCommunityPrices,
  readCommunityPrices,
  submitCommunityPrice,
} from "@/lib/communityPriceStore";

// With no Supabase env configured (the default under vitest), the store selects
// its process-memory backend. These pin the contract the durable backend must
// also satisfy: freshest-per-category reads, replace-your-own-observation,
// the penny envelope, and fail-soft empties on bad input.
//
// Vercel's CI presets real SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, which would
// otherwise flip communityPriceStore() over to the durable Supabase backend
// mid-suite - hitting a live, cross-run-persistent table these "memory backend"
// assertions never intend to exercise. Neutralize them exactly as
// priceConfirm.test.ts does.
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("communityPriceStore (memory backend)", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    __resetCommunityPrices();
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  it("stores an observation stamped community, at the server's clock", async () => {
    const { price } = await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "beer", priceGbp: 4.2, actor: "a" },
      1_000,
    );
    expect(price).toEqual({
      venueId: "v1",
      drinkCategory: "beer",
      priceGbp: 4.2,
      submittedAt: 1_000,
      source: "community",
    });
  });

  it("keeps one price per drink category, freshest first", async () => {
    await submitCommunityPrice({ venueId: "v1", drinkCategory: "beer", priceGbp: 4.2 }, 1_000);
    await submitCommunityPrice({ venueId: "v1", drinkCategory: "wine", priceGbp: 8.5 }, 2_000);

    const rows = await readCommunityPrices("v1");
    expect(rows.map((row) => row.drinkCategory)).toEqual(["wine", "beer"]);
    expect(rows.map((row) => row.priceGbp)).toEqual([8.5, 4.2]);
  });

  it("lets one device correct its own price instead of stacking a second row", async () => {
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "beer", priceGbp: 4.2, actor: "a" },
      1_000,
    );
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "beer", priceGbp: 4.6, actor: "a" },
      2_000,
    );

    const rows = await readCommunityPrices("v1");
    expect(rows).toHaveLength(1);
    expect(rows[0].priceGbp).toBe(4.6);
    expect(rows[0].submittedAt).toBe(2_000);
  });

  it("keeps two devices' observations distinct, freshest winning the read", async () => {
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "beer", priceGbp: 4.2, actor: "a" },
      1_000,
    );
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "beer", priceGbp: 5.1, actor: "b" },
      2_000,
    );

    const rows = await readCommunityPrices("v1");
    // Both observations are retained; the read surfaces the freshest one.
    expect(rows).toHaveLength(1);
    expect(rows[0].priceGbp).toBe(5.1);
  });

  it("scopes observations to their own venue", async () => {
    await submitCommunityPrice({ venueId: "v1", drinkCategory: "beer", priceGbp: 4.2 }, 1_000);
    expect(await readCommunityPrices("v2")).toEqual([]);
    expect(await readCommunityPrices("v1")).toHaveLength(1);
  });

  it("refuses out-of-envelope input with a null price, never throwing", async () => {
    for (const bad of [
      { venueId: "", drinkCategory: "beer" as const, priceGbp: 4.2 },
      { venueId: "v1", drinkCategory: "beer" as const, priceGbp: 0.5 },
      { venueId: "v1", drinkCategory: "beer" as const, priceGbp: 31 },
      { venueId: "v1", drinkCategory: "mead" as never, priceGbp: 4.2 },
    ]) {
      expect(await submitCommunityPrice(bad)).toEqual({ price: null });
    }
    expect(await readCommunityPrices("v1")).toEqual([]);
  });

  it("is honest-empty for a venue nobody has logged a price at", async () => {
    expect(await readCommunityPrices("never-logged")).toEqual([]);
    expect(await readCommunityPrices("")).toEqual([]);
  });
});
