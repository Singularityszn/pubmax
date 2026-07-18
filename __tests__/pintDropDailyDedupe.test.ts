import { beforeEach, describe, expect, it, vi } from "vitest";

// Supabase-backend coverage for the daily duplicate guard
// (supabasePintDropStore.hasPricedDropToday). A chainable query-builder mock
// records the filters and returns a scripted "newest priced row", so we can
// prove the London-day comparison without a live project. The memory backend +
// the route 409 are covered in pintDrops.test.ts — this pins the OTHER backend.

const filters: Record<string, unknown> = {};
let scriptedRows: Array<{ created_at: string }> = [];

function queryBuilder() {
  const qb: Record<string, unknown> = {};
  qb.select = () => qb;
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

import { supabasePintDropStore } from "@/lib/pintDropsStore";
import { londonDayKey } from "@/lib/pintContributions";

beforeEach(() => {
  for (const k of Object.keys(filters)) delete filters[k];
  scriptedRows = [];
});

describe("supabasePintDropStore.hasPricedDropToday", () => {
  it("returns true when the newest priced row is on the current London day", async () => {
    const today = londonDayKey(new Date());
    scriptedRows = [{ created_at: `${today}T12:00:00Z` }];

    const hit = await supabasePintDropStore.hasPricedDropToday("venue-x", "@Reg");
    expect(hit).toBe(true);
    // Filters the right axes, with the handle normalised.
    expect(filters["eq:venue_id"]).toBe("venue-x");
    expect(filters["eq:handle"]).toBe("reg");
    expect(filters["not:price_gbp"]).toBe("is:null");
    expect(filters["neq:status"]).toBe("hidden");
  });

  it("returns false when the newest priced row is from an earlier day", async () => {
    scriptedRows = [{ created_at: "2020-01-01T12:00:00Z" }];
    expect(await supabasePintDropStore.hasPricedDropToday("venue-x", "reg")).toBe(false);
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
