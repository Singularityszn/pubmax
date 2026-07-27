import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetCommunityPrices,
  countCorroboratedCommunityCategories,
  moderateCommunityPrice,
  readCommunityPriceCategoryIndex,
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
      // The observation's own opaque id - the handle a reader reports with and
      // a moderator hides by. Generated per row, so it is matched by shape.
      id: expect.any(String),
      venueId: "v1",
      drinkCategory: "beer",
      priceGbp: 4.2,
      submittedAt: 1_000,
      source: "community",
    });
    expect(price?.id).not.toBe("");
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

  it("indexes only requested categories across venues with trust metadata intact", async () => {
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "soft-drink", priceGbp: 3.2, actor: "a" },
      1_000,
    );
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "soft-drink", priceGbp: 3.3, actor: "b" },
      2_000,
    );
    await submitCommunityPrice(
      { venueId: "v2", drinkCategory: "alcohol-free", priceGbp: 5, actor: "c" },
      3_000,
    );
    await submitCommunityPrice(
      { venueId: "v3", drinkCategory: "beer", priceGbp: 6, actor: "d" },
      4_000,
    );

    const result = await readCommunityPriceCategoryIndex(
      ["soft-drink", "alcohol-free"],
      10_000,
    );
    expect(result.degraded).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.prices.map((row) => [row.venueId, row.drinkCategory])).toEqual([
      ["v2", "alcohol-free"],
      ["v1", "soft-drink"],
    ]);
    expect(result.prices.find((row) => row.venueId === "v1")?.mapCandidate).toEqual({
      priceGbp: 3.3,
      submittedAt: 2_000,
      corroborations: 2,
    });
    expect(JSON.stringify(result)).not.toContain('"actor"');
  });

  it("removes a hidden row from the category index without deleting it", async () => {
    const { price } = await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "soft-drink", priceGbp: 3.2, actor: "a" },
      1_000,
    );
    expect(price?.id).toBeTruthy();
    await moderateCommunityPrice(price!.id!, true, "menu mismatch");

    const result = await readCommunityPriceCategoryIndex(["soft-drink"], 10_000);
    expect(result.prices).toEqual([]);
  });

  // The index is the one read here that is neither per-venue nor per-actor, and
  // it costs a paged scan. An unauthenticated GET must not be able to bill that
  // scan once per visitor, so the answer is held briefly and a burst collapses
  // onto one read. A WRITE is the only thing that can change it, and drops it.
  it("answers a repeated index read from one scan, and a write drops it", async () => {
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "soft-drink", priceGbp: 3.2, actor: "a" },
      1_000,
    );
    const first = readCommunityPriceCategoryIndex(["soft-drink"], 10_000);
    const concurrent = readCommunityPriceCategoryIndex(["soft-drink"], 10_000);
    expect(concurrent).toBe(first);
    expect(readCommunityPriceCategoryIndex(["soft-drink"], 10_500)).toBe(first);
    expect((await first).prices).toHaveLength(1);

    await submitCommunityPrice(
      { venueId: "v2", drinkCategory: "soft-drink", priceGbp: 2.4, actor: "b" },
      11_000,
    );
    const afterWrite = readCommunityPriceCategoryIndex(["soft-drink"], 12_000);
    expect(afterWrite).not.toBe(first);
    expect((await afterWrite).prices).toHaveLength(2);

    // A read past the window is a fresh scan even with no write in between.
    const past = readCommunityPriceCategoryIndex(["soft-drink"], 72_001);
    expect(past).not.toBe(afterWrite);
    await past;
  });
});

// Corroboration counting: the number that decides whether a figure moves a pin.
// It is derived on the READ path from the per-(venue, category, actor) rows the
// store already keeps - no new column, no second write - so these cases are the
// contract the durable backend must match too (it counts the same rows through
// the same freshestPerCategory). Enforcement lives in
// components/map/communityPriceSignals.ts; this only pins the count.
describe("communityPriceStore corroboration counting (memory backend)", () => {
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

  async function beerAt(venueId: string, priceGbp: number, at: number, actor?: string) {
    await submitCommunityPrice({ venueId, drinkCategory: "beer", priceGbp, actor }, at);
  }

  it("counts a lone report as one voice", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    expect((await readCommunityPrices("v1"))[0].corroborations).toBe(1);
  });

  it("counts two devices agreeing within tolerance as two", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 4.5, 2_000, "b");

    const [row] = await readCommunityPrices("v1");
    // The freshest figure is the one being corroborated, and £4.20 is inside
    // its 50p window - so this is one price two people saw, not two prices.
    expect(row.priceGbp).toBe(4.5);
    expect(row.corroborations).toBe(2);
  });

  it("does not count a device that reported a different figure", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 6.5, 2_000, "b");

    const [row] = await readCommunityPrices("v1");
    // £4.20 does not corroborate £6.50; it contradicts it. A disagreement must
    // never read as support, or two people arguing would restamp the pin.
    expect(row.corroborations).toBe(1);
  });

  it("never lets one device corroborate itself by resubmitting", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 4.25, 2_000, "a");
    await beerAt("v1", 4.3, 3_000, "a");

    const rows = await readCommunityPrices("v1");
    // The store already collapses a device's own corrections to one row; this
    // asserts the trust count agrees, which is the whole spray defence.
    expect(rows).toHaveLength(1);
    expect(rows[0].corroborations).toBe(1);
  });

  it("counts all unattributed reports as at most one voice", async () => {
    // Anonymous rows (IP hashing unavailable) stack in storage - NULLs never
    // collide under the unique constraint - but they cannot be shown to come
    // from different people, and the threshold is about INDEPENDENCE.
    await beerAt("v1", 4.2, 1_000);
    await beerAt("v1", 4.25, 2_000);
    await beerAt("v1", 4.3, 3_000);
    expect((await readCommunityPrices("v1"))[0].corroborations).toBe(1);

    // One attributed device agreeing alongside them does make it two.
    await beerAt("v1", 4.3, 4_000, "a");
    expect((await readCommunityPrices("v1"))[0].corroborations).toBe(2);
  });

  it("counts each drink category on its own", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 4.3, 2_000, "b");
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "wine", priceGbp: 8.5, actor: "a" },
      3_000,
    );

    const rows = await readCommunityPrices("v1");
    const byCategory = new Map(rows.map((row) => [row.drinkCategory, row.corroborations]));
    // A wine report is not evidence about the pint, whatever it cost.
    expect(byCategory.get("beer")).toBe(2);
    expect(byCategory.get("wine")).toBe(1);
  });

  it("never leaks the actor token that the count is derived from", async () => {
    await beerAt("v1", 4.2, 1_000, "secret-device-token");
    const [row] = await readCommunityPrices("v1");
    expect(JSON.stringify(row)).not.toContain("secret-device-token");
    expect(row).not.toHaveProperty("actor");
  });
});

// The map candidate: the best-corroborated IN-WINDOW figure per category,
// riding alongside the freshest (sheet) row. This is what stops one device
// un-painting a corroborated price with a single disagreeing tap - the sheet
// stays freshest-wins, the map follows the best-backed figure until a
// contradiction itself reaches the threshold (mergeCommunityPriceSignals
// enforces; the store only states the facts).
describe("communityPriceStore map candidate (memory backend)", () => {
  const DAY = 86_400_000;

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

  async function beerAt(venueId: string, priceGbp: number, at: number, actor?: string) {
    await submitCommunityPrice({ venueId, drinkCategory: "beer", priceGbp, actor }, at);
  }

  it("hands the candidate to the corroborated cluster, not a lone fresh disagreement", async () => {
    // Devices A and B agree on £4.20; C's fresh £9.00 becomes the sheet row.
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 4.2, 2_000, "b");
    await beerAt("v1", 9, 3_000, "c");

    const [row] = await readCommunityPrices("v1", 10_000);
    // Sheet: freshest-wins, honestly one voice.
    expect(row.priceGbp).toBe(9);
    expect(row.corroborations).toBe(1);
    // Map: the corroborated figure, stamped with its cluster's freshest report.
    expect(row.mapCandidate).toEqual({
      priceGbp: 4.2,
      submittedAt: 2_000,
      corroborations: 2,
    });
  });

  it("moves the candidate once the contradiction reaches the threshold itself", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 4.2, 2_000, "b");
    await beerAt("v1", 9, 3_000, "c");
    await beerAt("v1", 9, 4_000, "d");

    const [row] = await readCommunityPrices("v1", 10_000);
    // Both clusters count two voices; the tie goes to the fresher cluster,
    // which is exactly "the new price takes over once it is confirmed".
    expect(row.mapCandidate).toEqual({
      priceGbp: 9,
      submittedAt: 4_000,
      corroborations: 2,
    });
  });

  it("attaches no candidate when every report has aged out of the window", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 4.2, 2_000, "b");

    const [row] = await readCommunityPrices("v1", 2_000 + 31 * DAY);
    // The sheet keeps the dated row; the map has nothing current to stand on.
    expect(row.priceGbp).toBe(4.2);
    expect(row.mapCandidate).toBeUndefined();
  });

  it("skips aged-out clusters when picking the candidate", async () => {
    // The corroborated £4.20 has aged out; only C's lone report is current.
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 4.2, 2_000, "b");
    await beerAt("v1", 9, 35 * DAY, "c");

    const [row] = await readCommunityPrices("v1", 35 * DAY + 1_000);
    // The candidate is stated honestly at one voice - the merge's threshold
    // gate is what keeps it off the map, not a hidden count.
    expect(row.mapCandidate).toEqual({
      priceGbp: 9,
      submittedAt: 35 * DAY,
      corroborations: 1,
    });
  });

  it("counts candidate clusters per category, and only for that category", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 4.2, 2_000, "b");
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "wine", priceGbp: 8.5, actor: "c" },
      3_000,
    );

    const rows = await readCommunityPrices("v1", 10_000);
    const byCategory = new Map(rows.map((row) => [row.drinkCategory, row.mapCandidate]));
    expect(byCategory.get("beer")).toEqual({
      priceGbp: 4.2,
      submittedAt: 2_000,
      corroborations: 2,
    });
    expect(byCategory.get("wine")).toEqual({
      priceGbp: 8.5,
      submittedAt: 3_000,
      corroborations: 1,
    });
  });
});

describe("countCorroboratedCommunityCategories (memory backend)", () => {
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

  const DAY = 24 * 60 * 60 * 1000;

  async function beerAt(venueId: string, priceGbp: number, at: number, actor?: string) {
    await submitCommunityPrice({ venueId, drinkCategory: "beer", priceGbp, actor }, at);
  }

  it("counts nothing when nothing has been logged", async () => {
    const result = await countCorroboratedCommunityCategories(10_000);
    expect(result).toEqual({ count: 0, truncated: false, degraded: false });
  });

  it("does not count a lone report", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    expect((await countCorroboratedCommunityCategories(10_000)).count).toBe(0);
  });

  it("counts a (venue, category) pair once a second submitter agrees", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 4.25, 2_000, "b");
    const result = await countCorroboratedCommunityCategories(10_000);
    expect(result.count).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("counts each category and each venue separately", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 4.2, 2_000, "b");
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "wine", priceGbp: 8.5, actor: "a" },
      1_000,
    );
    await submitCommunityPrice(
      { venueId: "v1", drinkCategory: "wine", priceGbp: 8.5, actor: "b" },
      2_000,
    );
    await beerAt("v2", 6.5, 1_000, "a");
    await beerAt("v2", 6.5, 2_000, "b");
    expect((await countCorroboratedCommunityCategories(10_000)).count).toBe(3);
  });

  it("drops a pair once its corroboration ages past the window", async () => {
    await beerAt("v1", 4.2, DAY, "a");
    await beerAt("v1", 4.2, DAY, "b");
    expect((await countCorroboratedCommunityCategories(2 * DAY)).count).toBe(1);
    // Same rows, read 40 days on: outside the age window, so the map paints
    // nothing and neither does the count.
    expect((await countCorroboratedCommunityCategories(41 * DAY)).count).toBe(0);
  });

  it("does not count two reports that contradict each other", async () => {
    await beerAt("v1", 4.2, 1_000, "a");
    await beerAt("v1", 9, 2_000, "b");
    expect((await countCorroboratedCommunityCategories(10_000)).count).toBe(0);
  });
});
