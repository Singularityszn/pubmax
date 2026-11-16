import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], cap: 500, failAfter: "", omitCount: false }));
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
  requireSupabaseAdmin: () => ({ from: () => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let take = 500;
    let cursor = "";
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      is: (key: string) => { filters.push((row) => row[key] == null); return query; },
      not: (key: string) => { filters.push((row) => row[key] != null); return query; },
      order: () => query,
      limit: (limit: number) => { take = limit; return query; },
      gt: (_key: string, value: string) => { cursor = value; return query; },
      then: (resolve: (value: unknown) => void) => {
        const rows = db.rows.filter((row) => filters.every((filter) => filter(row)) && String(row.id) > cursor)
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        return Promise.resolve(db.failAfter && cursor >= db.failAfter
          ? { data: null, error: { message: "page unavailable" }, count: null }
          : { data: rows.slice(0, Math.min(take, db.cap)), error: null, count: db.omitCount ? null : rows.length }).then(resolve);
      },
    };
    return query;
  } }),
}));

import { memoryPintDropStore, supabasePintDropStore } from "@/lib/pintDropsStore";
import { supabaseCommunityPriceStore } from "@/lib/communityPriceStore";
import { __resetMemoryProfileWithdrawals, __setMemoryProfileWithdrawn } from "@/lib/accountPublicAccess.server";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";

function drop(id: string, visibility = "public") {
  return { id, venue_id: "current", handle: "drinker", status: "visible", visibility, drink: "Lager", price_gbp: 5,
    created_at: "2026-01-01T00:00:00Z", provenance: "contributor", passed_down_note: "", era: "" };
}
afterEach(() => { db.rows = []; db.cap = 500; db.failAfter = ""; db.omitCount = false; __resetPintDrops(); __resetMemoryProfiles(); __resetMemoryProfileWithdrawals(); });

describe("public priced venues across every page", () => {
  it("finds an older priced drop beyond 500 private rows without exposing those rows", async () => {
    db.rows = Array.from({ length: 500 }, (_, n) => drop(String(n).padStart(4, "0"), n % 2 ? "friends" : "legacy"));
    db.rows.push(drop("0500", "anonymous"));
    expect(await supabasePintDropStore.publicPricedVenueIds(["current"])).toEqual(new Set(["current"]));
  });
  it("continues when the server returns fewer rows than requested", async () => {
    db.cap = 1;
    db.rows = [drop("1", "friends"), drop("2", "public")];
    expect(await supabasePintDropStore.publicPricedVenueIds(["current"])).toEqual(new Set(["current"]));
  });
  it("excludes hidden, private, legacy and unpriced drops", async () => {
    db.rows = [drop("1", "friends"), drop("2", "legacy"), { ...drop("3"), status: "hidden" }, { ...drop("4"), price_gbp: null }];
    expect(await supabasePintDropStore.publicPricedVenueIds(["current"])).toEqual(new Set());
  });
  it("excludes a withdrawn author from public-price presence", async () => {
    db.rows = [drop("1")];
    __setMemoryProfileWithdrawn(__seedMemoryOwnedProfile("drinker", "withdrawn-user").id, true);
    expect(await supabasePintDropStore.publicPricedVenueIds(["current"])).toEqual(new Set());
  });
  it("keeps a missing page or count distinct from absence", async () => {
    db.cap = 1; db.rows = [drop("1", "friends"), drop("2")]; db.failAfter = "1";
    await expect(supabasePintDropStore.publicPricedVenueIds(["current"])).rejects.toThrow("page unavailable");
    db.failAfter = ""; db.omitCount = true;
    await expect(supabasePintDropStore.publicPricedVenueIds(["current"])).rejects.toThrow("Incomplete");
  });
  it("reads every community category past its 200-row window and honours hidden rows", async () => {
    db.rows = Array.from({ length: 201 }, (_, n) => ({ id: String(n).padStart(4, "0"), venue_id: n === 200 ? "old" : "current",
      drink_category: "wine", price_pennies: 600, hidden_at: null }));
    db.rows.push({ id: "hidden", venue_id: "private", drink_category: "beer", price_pennies: 400, hidden_at: "2026-01-01" });
    expect(await supabaseCommunityPriceStore.publicPricedVenueIds(["current", "old", "private"]))
      .toEqual(new Set(["current", "old"]));
  });
  it("rejects an incomplete or invalid community read", async () => {
    db.omitCount = true;
    await expect(supabaseCommunityPriceStore.publicPricedVenueIds(["current"])).rejects.toThrow("Incomplete");
    db.omitCount = false;
    db.rows = [{ id: "1", venue_id: "current", drink_category: "wine", price_pennies: "600", hidden_at: null }];
    await expect(supabaseCommunityPriceStore.publicPricedVenueIds(["current"])).rejects.toThrow("Invalid");
  });
  it("checks the complete keyless store without a timeline cap", async () => {
    for (let n = 0; n < 501; n++) addPintDrop({ id: String(n), venueId: "current", handle: "drinker", drink: "Lager",
      priceGbp: n === 0 ? 5 : null, passedDownNote: "", era: "", provenance: "contributor", status: "visible", createdAt: new Date(n).toISOString() });
    expect(await memoryPintDropStore.publicPricedVenueIds(["current"])).toEqual(new Set(["current"]));
  });
});
