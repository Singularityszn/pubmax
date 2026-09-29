import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  stopRow: null as Record<string, unknown> | null,
  completionRow: null as Record<string, unknown> | null,
  oldSchema: false,
  context: { drinkCategory: "wine", zeroProof: false },
  selects: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({
    from: (table: string) => {
      let columns = "";
      const query = {
        select(value: string) { columns = value; if (table === "plan_stops") db.selects.push(value); return query; },
        eq() { return query; },
        is() { return query; },
        order() { return query; },
        then(onFulfilled: (value: { data: Record<string, unknown>[] | null; error: { code: string; message: string } | null }) => unknown) {
          if (table === "plan_stops") {
            if (db.oldSchema && columns.includes("selected_drink_price_evidence")) {
              return Promise.resolve({ data: null, error: { code: "42703", message: "column plan_stops.selected_drink_price_evidence does not exist" } }).then(onFulfilled);
            }
            const row = db.stopRow && db.oldSchema
              ? Object.fromEntries(Object.entries(db.stopRow).filter(([key]) => key !== "selected_drink_price_evidence"))
              : db.stopRow;
            return Promise.resolve({ data: row ? [row] : [], error: null }).then(onFulfilled);
          }
          return Promise.resolve({ data: [], error: null }).then(onFulfilled);
        },
        maybeSingle: async () => ({
          data: table === "plan_completions" ? db.completionRow : { id: "11111111-1111-4111-8111-111111111111", title: "Tonight", start_time: "2026-09-30T19:00:00.000Z", created_at: "2026-09-29T12:00:00.000Z", night_context: db.context },
          error: null,
        }),
      };
      return query;
    },
  }),
}));

import { supabasePlanStore } from "@/lib/planStore";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const EVIDENCE = {
  category: "wine",
  pence: 550,
  serving: null,
  source: "community",
  reportedAt: "2026-09-25T12:00:00.000Z",
};

describe("saved Plan selected drink evidence reads", () => {
  beforeEach(() => {
    db.oldSchema = false;
    db.context = { drinkCategory: "wine", zeroProof: false };
    db.selects = [];
    db.completionRow = null;
    db.stopRow = { venue_id: "venue-a", venue_name: "A", position: 0, selected_drink_price_evidence: EVIDENCE };
  });

  it("returns bounded selected evidence on a member Plan read", async () => {
    const result = await supabasePlanStore.read(PLAN_ID);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.state.stops[0]?.selectedDrinkPriceEvidence).toEqual(EVIDENCE);
    expect(db.selects[0]).toContain("selected_drink_price_evidence");
  });

  it.each([{ drinkCategory: "cocktail", zeroProof: false }, { drinkCategory: "wine", zeroProof: true }])("filters primary and backup evidence for changed context %o", async (context) => {
    db.context = context;
    db.stopRow = { ...db.stopRow, alternatives: [{ venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: EVIDENCE }] };
    const result = await supabasePlanStore.read(PLAN_ID);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.state.stops[0]).toEqual({ venueId: "venue-a", venueName: "A", position: 0, alternatives: [{ venueId: "venue-b", venueName: "B" }] });
  });

  it("drops malformed evidence instead of publishing it", async () => {
    db.stopRow = { ...db.stopRow, selected_drink_price_evidence: { ...EVIDENCE, serving: "175ml", contributor: "Ada" } };
    const result = await supabasePlanStore.read(PLAN_ID);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.state.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("reads the route against the old schema after a missing-column error", async () => {
    db.oldSchema = true;
    const result = await supabasePlanStore.read(PLAN_ID);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.state.stops[0]).toMatchObject({ venueId: "venue-a", venueName: "A", position: 0 });
    expect(result.state.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    expect(db.selects).toEqual([
      "venue_id,venue_name,position,selected_drink_price_evidence,alternatives",
      "venue_id,venue_name,position,selected_drink_price_evidence",
      "venue_id,venue_name,position",
    ]);
  });

  it("returns bounded selected evidence from a saved completion snapshot", async () => {
    db.completionRow = {
      id: "22222222-2222-4222-8222-222222222222",
      plan_id: PLAN_ID,
      ending: "get_home",
      route_revision: 1,
      route_snapshot: [{ venueId: "venue-a", venueName: "A", position: 0, selectedDrinkPriceEvidence: EVIDENCE }],
      completed_at: "2026-09-30T23:00:00.000Z",
    };
    const completion = await supabasePlanStore.getCompletion(PLAN_ID);
    expect(completion?.routeSnapshot[0]?.selectedDrinkPriceEvidence).toEqual(EVIDENCE);
    db.completionRow = { ...db.completionRow, route_snapshot: [{ venueId: "venue-a", venueName: "A", position: 0, selectedDrinkPriceEvidence: { ...EVIDENCE, serving: "175ml", contributor: "private" } }] };
    const malformed = await supabasePlanStore.getCompletion(PLAN_ID);
    expect(malformed?.routeSnapshot[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });
});
