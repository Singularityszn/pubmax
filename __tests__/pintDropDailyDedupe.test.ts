import { beforeEach, describe, expect, it, vi } from "vitest";

// Supabase-backend coverage for the daily duplicate guard
// (supabasePintDropStore.hasPricedDropToday). A chainable query-builder mock
// records the filters and returns a scripted "newest priced row", so we can
// prove the London-day comparison without a live project. The memory backend +
// the route 409 are covered in pintDrops.test.ts — this pins the OTHER backend.

// Fixed clock so the London-day comparison never straddles a real midnight
// (the store reads its `now` argument, never the wall clock). Model:
// __tests__/priceConfidence.test.ts.
const NOW = 1_800_000_000_000;

const filters: Record<string, unknown> = {};
let scriptedRows: Array<{ created_at: string }> = [];
// The insert half: rows the store actually sent, and a queue of errors to hand
// back so a first attempt can fail and a retry succeed.
const insertedRows: Array<Record<string, unknown>> = [];
let scriptedInsertErrors: Array<{ code?: string; message?: string; details?: string } | null> = [];

function queryBuilder() {
  const qb: Record<string, unknown> = {};
  qb.select = () => qb;
  qb.insert = async (row: Record<string, unknown>) => {
    insertedRows.push(row);
    return { error: scriptedInsertErrors.shift() ?? null };
  };
  qb.eq = (col: string, val: unknown) => {
    filters[`eq:${col}`] = val;
    return qb;
  };
  qb.not = (col: string, op: string, val: unknown) => {
    filters[`not:${col}`] = `${op}:${val}`;
    return qb;
  };
  qb.neq = (col: string, val: unknown) => {
    filters[`neq:${col}`] = val;
    return qb;
  };
  qb.order = () => qb;
  qb.limit = async () => ({ data: scriptedRows, error: null });
  return qb;
}

vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => ({ from: () => queryBuilder() }),
  getSupabaseAdmin: () => ({ from: () => queryBuilder() }),
  isSupabaseConfigured: () => true,
  STORAGE_BUCKET: "pint-drops",
}));

import {
  isPintDropDailyCapError,
  supabasePintDropStore,
} from "@/lib/pintDropsStore";
import { londonDayKey } from "@/lib/pintContributions";
import { defined } from "@/__tests__/helpers/defined";

beforeEach(() => {
  for (const k of Object.keys(filters)) delete filters[k];
  scriptedRows = [];
  insertedRows.length = 0;
  scriptedInsertErrors = [];
});

// One drop, priced unless told otherwise, dated to a fixed London day so the
// stamp under test never straddles a real midnight.
const CREATED_AT = "2026-09-04T11:00:00.000Z";
function drop(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-00000000d101",
    venueId: "venue-x",
    handle: "reg",
    drink: "Pint",
    priceGbp: 4.5,
    passedDownNote: "",
    era: "",
    provenance: "contributor" as const,
    status: "visible" as const,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

const NO_PHOTOS = { pint: null, venue: null, receipt: null };
// The cap is a WRITE PATH's rule: POST /api/pint-drops opts in, the
// community-price pairing lane does not. Every case here is the capped lane
// unless it says otherwise.
const CAPPED = { underDailyPriceCap: true } as const;

const CAP_VIOLATION = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "pint_drops_priced_day_unique_idx"',
  details: "Key (venue_id, handle, price_day)=(venue-x, reg, 2026-09-04) already exists.",
};

describe("supabasePintDropStore.hasPricedDropToday", () => {
  it("returns true when the newest priced row is on the current London day", async () => {
    const today = londonDayKey(new Date(NOW));
    scriptedRows = [{ created_at: `${today}T12:00:00Z` }];

    const hit = await supabasePintDropStore.hasPricedDropToday("venue-x", "@Reg", NOW);
    expect(hit).toBe(true);
    // Filters the right axes, with the handle normalised.
    expect(filters["eq:venue_id"]).toBe("venue-x");
    expect(filters["eq:handle"]).toBe("reg");
    expect(filters["not:price_gbp"]).toBe("is:null");
    expect(filters["neq:status"]).toBe("hidden");
  });

  it("returns false when the newest priced row is from an earlier day", async () => {
    scriptedRows = [{ created_at: "2020-01-01T12:00:00Z" }];
    expect(await supabasePintDropStore.hasPricedDropToday("venue-x", "reg", NOW)).toBe(false);
  });

  it("returns false when the contributor has no priced rows here", async () => {
    scriptedRows = [];
    expect(await supabasePintDropStore.hasPricedDropToday("venue-x", "reg")).toBe(false);
  });

  it("returns false for a blank handle without hitting the DB", async () => {
    expect(await supabasePintDropStore.hasPricedDropToday("venue-x", "")).toBe(false);
    expect(filters["eq:venue_id"]).toBeUndefined();
  });
});

// The HARD half of the cap (migration 0141, pentest F-1). The pre-check above
// cannot see a concurrent burst; the unique index can, and what it says has to
// arrive at the route as a refusal rather than as an outage.
describe("supabasePintDropStore.create - the daily cap guard", () => {
  it("stamps the drop's own London day on a priced drop", async () => {
    await supabasePintDropStore.create(drop(), NO_PHOTOS, CAPPED);
    expect(insertedRows).toHaveLength(1);
    expect(defined(insertedRows[0]).price_day).toBe(londonDayKey(CREATED_AT));
    expect(defined(insertedRows[0]).price_day).toBe("2026-09-04");
  });

  it("stamps nothing on a note-only memory, which is not a price observation", async () => {
    await supabasePintDropStore.create(
      drop({ priceGbp: null, passedDownNote: "granddad drank here" }),
      NO_PHOTOS,
      CAPPED,
    );
    expect(defined(insertedRows[0]).price_day).toBeNull();
  });

  it("turns the index's refusal into the daily-cap refusal, not a storage fault", async () => {
    scriptedInsertErrors = [CAP_VIOLATION];
    await expect(supabasePintDropStore.create(drop(), NO_PHOTOS, CAPPED)).rejects.toSatisfy(
      isPintDropDailyCapError,
    );
    // One attempt: a cap refusal is the rule, so nothing is retried around it.
    expect(insertedRows).toHaveLength(1);
  });

  it("leaves any OTHER unique collision as the fault it is", async () => {
    scriptedInsertErrors = [
      {
        code: "23505",
        message: 'duplicate key value violates unique constraint "pint_drops_pkey"',
      },
    ];
    const failure = await supabasePintDropStore.create(drop(), NO_PHOTOS, CAPPED).catch((err) => err);
    expect(isPintDropDailyCapError(failure)).toBe(false);
    expect(failure).toBeInstanceOf(Error);
  });

  it("keeps the drop when 0141 is not applied yet, unstamped", async () => {
    scriptedInsertErrors = [
      { code: "PGRST204", message: "Could not find the 'price_day' column of 'pint_drops'" },
    ];
    await supabasePintDropStore.create(drop(), NO_PHOTOS, CAPPED);
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0]).toHaveProperty("price_day");
    expect(insertedRows[1]).not.toHaveProperty("price_day");
  });
});

// The lane the cap does NOT govern. POST /api/price-submit pairs a Pint Drop
// with every community price a drinker sends, and takes several from one
// account at one pub in one day on purpose, so its writes claim no day and the
// index cannot see them.
describe("supabasePintDropStore.create - the lane the cap leaves alone", () => {
  it("claims no day when the caller did not opt into the cap", async () => {
    await supabasePintDropStore.create(drop(), NO_PHOTOS);
    expect(defined(insertedRows[0]).price_day).toBeNull();
  });
});
